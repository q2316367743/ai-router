import type { Readable } from 'node:stream'
import {
  serializeOutboundHeaders,
  serializeResponseHeaders,
  startRequest
} from '../logging/requestLog'
import { collectExtraHeaders } from '../upstream/forwardHeaders'
import { joinEndpoint, upstreamPathOf } from '../upstream/urls'
import { postUpstreamStream, responseHeadersOf } from '../upstream/httpClient'
import { classifyFailure } from '../balancer/classify'
import { captureResponseText, createWireCapture, type WireCapture } from './wireCapture'
import { createSseParser } from './sse'
import type { ApiUsage, Conversation } from './conversation'
import type { AttemptOutcome, ProtocolStrategy, RequestContext } from './types'

/**
 * 异协议转发：入口协议解析为统一会话 → 上游协议构建报文 → axios 直连 →
 * 上游解码为统一事件/结果 → 入口协议编码回写。日志为线上口径：
 * 请求侧记上游构建的报文，响应侧记提供商原始返回。非流式为真·非流式上游请求。
 *
 * **提交时机**（决定能否改道）：入口编码器的响应头是惰性的（首次写事件才写头），
 * 因此上游非 2xx 与流内首 token 前的失败都还没向客户端写过字节，交给改道循环处置。
 * 会话解析在循环外只做一次（多协议候选下解析结果与渠道无关）。
 */
export async function converted(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy,
  conversation: Conversation
): Promise<AttemptOutcome> {
  const { req, res, route, publicModel, requestId, client, startedAt, controller } = ctx
  const signal = controller.signal
  // 日志 path 记上游实际请求路径（而非客户端入口路径）
  const logPath = upstreamPathOf(joinEndpoint(route.providerBaseUrl, upstream.upstreamPath))
  const capture = createWireCapture()
  const wire = (): AttemptOutcome['wire'] => ({
    body: capture.requestBody,
    headers: capture.requestHeaders
  })

  const wireRequest = upstream.buildRequest(conversation, route, collectExtraHeaders(req))
  capture.requestBody = JSON.stringify(wireRequest.body)
  capture.requestHeaders = serializeOutboundHeaders(wireRequest.headers)

  // 转发前先落 pending 日志（日志页即时可见「进行中」）；stream 按原始 body 预判
  if (ctx.firstAttempt) {
    startRequest({
      requestId,
      startedAt,
      publicModel,
      providerName: route.providerName,
      upstreamModel: route.upstreamName,
      providerId: route.providerId,
      modelId: route.modelId,
      client,
      path: logPath,
      stream: conversation.stream
    })
  }

  const call = await postUpstreamStream(
    wireRequest.url,
    capture.requestBody,
    wireRequest.headers,
    signal
  )
  if (!call.ok) {
    if (call.reason === 'aborted') {
      return uncommitted({
        kind: 'client',
        status: 499,
        wire: wire(),
        path: logPath,
        stream: conversation.stream,
        message: 'client aborted',
        serve: null
      })
    }
    const message = `Upstream request failed: ${call.message}`
    return uncommitted({
      kind: 'upstream',
      status: 502,
      wire: wire(),
      path: logPath,
      stream: conversation.stream,
      message,
      serve: () => entry.writeError(res, 502, message)
    })
  }

  const upstreamRes = call.response
  capture.responseHeaders = serializeResponseHeaders(responseHeadersOf(upstreamRes))

  // 非 2xx：读全量错误体后不立即回写，交给改道循环（无可改道时按入口协议信封回放）
  if (upstreamRes.status >= 400) {
    const bodyText = await readAll(capture, upstreamRes.data, signal)
    if (signal.aborted) {
      return uncommitted({
        kind: 'client',
        status: 499,
        wire: wire(),
        path: logPath,
        stream: conversation.stream,
        message: 'client aborted',
        serve: null
      })
    }
    const message = summarizeUpstreamError(upstreamRes.status, bodyText)
    return uncommitted({
      kind: classifyFailure(upstreamRes.status, bodyText),
      status: upstreamRes.status,
      upstreamStatus: upstreamRes.status,
      wire: wire(),
      path: logPath,
      stream: conversation.stream,
      message,
      serve: () => entry.writeError(res, upstreamRes.status, message),
      resBody: capture.responseBody,
      resHeaders: capture.responseHeaders
    })
  }

  if (!conversation.stream) {
    return respondBuffered(ctx, entry, upstream, capture, upstreamRes, signal, logPath)
  }
  return respondStreamed(ctx, entry, upstream, capture, upstreamRes, signal, logPath)
}

/** 非流式：读全量 JSON → 上游解码为统一结果 → 入口编码一次性回写 */
async function respondBuffered(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy,
  capture: WireCapture,
  upstreamRes: { status: number; data: Readable },
  signal: AbortSignal,
  logPath: string
): Promise<AttemptOutcome> {
  const bodyText = await readAll(capture, upstreamRes.data, signal)
  const wire = { body: capture.requestBody, headers: capture.requestHeaders }
  if (signal.aborted) {
    return uncommitted({
      kind: 'client',
      status: 499,
      wire,
      path: logPath,
      stream: false,
      message: 'client aborted',
      serve: null
    })
  }
  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    const message = 'Upstream returned a non-JSON response'
    return uncommitted({
      kind: 'upstream',
      status: 502,
      upstreamStatus: upstreamRes.status,
      wire,
      path: logPath,
      stream: false,
      message,
      serve: () => entry.writeError(ctx.res, 502, message)
    })
  }
  const completion = upstream.decodeResponse(payload)
  const localBody = entry.encodeCompletion(ctx.res, ctx.publicModel, completion)
  return {
    kind: 'ok',
    committed: localBody !== null,
    status: upstreamRes.status,
    upstreamStatus: upstreamRes.status,
    stream: false,
    path: logPath,
    usage: completion.usage,
    wire,
    // 线上口径：日志记提供商原始返回；本地生成的正文仅在上游无响应时兜底
    resBody: capture.responseBody ?? localBody,
    resHeaders: capture.responseHeaders,
    message: null,
    serve: null
  }
}

/** 流式：上游解码 → 统一事件 → 入口编码回写（惰性响应头，可中途改道协议错误信封） */
async function respondStreamed(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy,
  capture: WireCapture,
  upstreamRes: { status: number; data: Readable },
  signal: AbortSignal,
  logPath: string
): Promise<AttemptOutcome> {
  const wire = { body: capture.requestBody, headers: capture.requestHeaders }
  const encoder = entry.createEntryEncoder(ctx.res, ctx.publicModel)
  let usage: ApiUsage | null = null
  const decoder = upstream.createUpstreamDecoder(async (event) => {
    if (event.type === 'finish') usage = event.usage
    await encoder.write(event)
  })
  const parser = createSseParser()
  const sse = new TextDecoder()

  // 客户端断开（signal abort）时销毁上游连接，读取循环随之终止
  const onAbort = (): void => {
    upstreamRes.data.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    for await (const chunk of readChunks(upstreamRes.data)) {
      const text = sse.decode(chunk, { stream: true })
      captureResponseText(capture, text)
      for (const event of parser.feed(text)) {
        if (!decoder.done) await decoder.handleEvent(event)
      }
      if (decoder.done) break
    }
    for (const event of parser.flush()) {
      if (!decoder.done) await decoder.handleEvent(event)
    }
    await decoder.flush()
  } catch {
    // 客户端断开（abort → destroy）或上游异常：下方按 aborted / 流中断收口
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  // 终态后上游可能还有残余字节，提前释放连接
  if (decoder.done && !upstreamRes.data.destroyed) upstreamRes.data.destroy()

  if (signal.aborted) {
    return settle({
      kind: 'client',
      status: 499,
      upstreamStatus: null,
      wire,
      path: logPath,
      capture,
      stream: true,
      usage: null,
      message: 'client aborted',
      committed: encoder.headWritten
    })
  }

  const failure = decoder.failure
  if (failure) {
    if (!encoder.headWritten) {
      return uncommitted({
        kind: 'upstream',
        status: failure.status,
        upstreamStatus: upstreamRes.status,
        wire,
        path: logPath,
        stream: true,
        message: failure.message,
        serve: () => entry.writeError(ctx.res, failure.status, failure.message)
      })
    }
    await encoder.writeError(failure.message)
    encoder.end()
    return settle({
      kind: 'upstream',
      status: failure.status,
      upstreamStatus: upstreamRes.status,
      wire,
      path: logPath,
      capture,
      stream: true,
      usage: null,
      message: failure.message
    })
  }

  if (!decoder.completed) {
    // 上游流在终态事件前中断（连接提前关闭）
    const message = 'Upstream stream ended unexpectedly'
    if (!encoder.headWritten) {
      return uncommitted({
        kind: 'upstream',
        status: 502,
        upstreamStatus: upstreamRes.status,
        wire,
        path: logPath,
        stream: true,
        message,
        serve: () => entry.writeError(ctx.res, 502, message)
      })
    }
    await encoder.writeError(message)
    encoder.end()
    return settle({
      kind: 'upstream',
      status: 502,
      upstreamStatus: upstreamRes.status,
      wire,
      path: logPath,
      capture,
      stream: true,
      usage,
      message
    })
  }

  encoder.end()
  return settle({
    kind: 'ok',
    status: upstreamRes.status,
    upstreamStatus: upstreamRes.status,
    wire,
    path: logPath,
    capture,
    stream: true,
    usage,
    message: null
  })
}

/** 已提交结果（响应已向客户端写出，不可再改道） */
function settle(args: {
  kind: AttemptOutcome['kind']
  status: number
  upstreamStatus: number | null
  wire: AttemptOutcome['wire']
  path: string
  capture: WireCapture
  stream: boolean
  usage: ApiUsage | null
  message: string | null
  /** 客户端断开等场景下可能尚未写头，此时仍算未提交 */
  committed?: boolean
}): AttemptOutcome {
  return {
    kind: args.kind,
    committed: args.committed ?? true,
    status: args.status,
    upstreamStatus: args.upstreamStatus,
    stream: args.stream,
    path: args.path,
    usage: args.usage,
    wire: args.wire,
    resBody: args.capture.responseBody,
    resHeaders: args.capture.responseHeaders,
    message: args.message,
    serve: null
  }
}

/** 未提交失败：本次尝试没向客户端写过任何字节，可改道；`serve` 供最后回放 */
function uncommitted(args: {
  kind: AttemptOutcome['kind']
  status: number
  wire: AttemptOutcome['wire']
  path: string
  stream: boolean
  message: string
  serve: (() => string | null) | null
  upstreamStatus?: number | null
  resBody?: string | null
  resHeaders?: string | null
}): AttemptOutcome {
  return {
    kind: args.kind,
    committed: false,
    status: args.status,
    upstreamStatus: args.upstreamStatus ?? null,
    stream: args.stream,
    path: args.path,
    usage: null,
    wire: args.wire,
    resBody: args.resBody ?? null,
    resHeaders: args.resHeaders ?? null,
    message: args.message,
    serve: args.serve
  }
}

/** 上游错误响应 → 客户端与日志共用的消息：状态码 + 正文前 300 字摘要 */
function summarizeUpstreamError(status: number, bodyText: string): string {
  const body = bodyText ? `: ${bodyText.slice(0, 300)}` : ''
  return `Upstream request failed with status ${status}${body}`
}

/** 读全量上游正文并累积进线上捕获（abort 时销毁流终止读取，保留已收部分） */
async function readAll(
  capture: WireCapture,
  stream: Readable,
  signal: AbortSignal
): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  const onAbort = (): void => {
    stream.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of readChunks(stream)) {
      const part = decoder.decode(chunk, { stream: true })
      text += part
      captureResponseText(capture, part)
    }
    const rest = decoder.decode()
    if (rest) {
      text += rest
      captureResponseText(capture, rest)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  return text
}

/** Readable 的 async iterator 声明为 any，收窄为 Buffer 后再参与后续处理 */
async function* readChunks(stream: Readable): AsyncGenerator<Buffer> {
  for await (const chunk of stream) yield chunk as Buffer
}
