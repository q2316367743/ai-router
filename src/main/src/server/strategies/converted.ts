import type { Readable } from 'node:stream'
import type { AxiosResponse } from 'axios'
import {
  recordRequest,
  serializeOutboundHeaders,
  serializeResponseHeaders,
  startRequest,
  type TokenUsage
} from '../logging/requestLog'
import { errMsg } from '../respond'
import { collectExtraHeaders } from '../upstream/forwardHeaders'
import { joinEndpoint, upstreamPathOf } from '../upstream/urls'
import { getUpstreamClient, responseHeadersOf } from '../upstream/httpClient'
import { captureResponseText, createWireCapture, type WireCapture } from './wireCapture'
import { createSseParser } from './sse'
import { toTokenUsage, type ApiUsage, type Conversation } from './conversation'
import type { ProtocolStrategy, RequestContext } from './types'

interface ConversionOutcome {
  status: number
  stream: boolean
  usage: TokenUsage | null
  errorSnippet: string | null
  /** 本地生成的响应正文（拦截分支的协议错误 JSON）；有上游响应时日志取线上捕获 */
  localResBody: string | null
}

/**
 * 异协议转发：入口协议解析为统一会话 → 上游协议构建报文 → axios 直连 →
 * 上游解码为统一事件/结果 → 入口协议编码回写。日志为线上口径：
 * 请求侧记上游构建的报文，响应侧记提供商原始返回。非流式为真·非流式上游请求。
 */
export async function converted(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy
): Promise<void> {
  const { req, body, res, route, publicModel, requestId, client, startedAt } = ctx
  // 日志 path 记上游实际请求路径（而非客户端入口路径）
  const logPath = upstreamPathOf(joinEndpoint(route.providerBaseUrl, upstream.upstreamPath))
  const capture = createWireCapture()
  const finish = (outcome: ConversionOutcome): void => {
    recordRequest({
      path: logPath,
      requestId,
      publicModel,
      providerName: route.providerName,
      upstreamModel: route.upstreamName,
      providerId: route.providerId,
      modelId: route.modelId,
      client,
      startedAt,
      status: outcome.status,
      stream: outcome.stream,
      usage: outcome.usage,
      error: outcome.errorSnippet,
      reqBody: capture.requestBody,
      reqHeaders: capture.requestHeaders,
      resBody: capture.responseBody ?? outcome.localResBody,
      resHeaders: capture.responseHeaders
    })
  }

  // 转发前先落 pending 日志（日志页即时可见「进行中」）；stream 按原始 body 预判，与解析成败无关
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
    stream: body['stream'] === true
  })

  let conversation: Conversation
  try {
    conversation = entry.parseRequest(body)
  } catch (err) {
    const message = errMsg(err)
    const localResBody = entry.writeError(res, 400, message)
    finish({ status: 400, stream: false, usage: null, errorSnippet: message, localResBody })
    return
  }

  const wire = upstream.buildRequest(conversation, route, collectExtraHeaders(req))
  capture.requestBody = JSON.stringify(wire.body)
  capture.requestHeaders = serializeOutboundHeaders(wire.headers)

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  // validateStatus 全放行：非 2xx 也由下方统一处理（错误正文同样入库）
  let upstreamRes: AxiosResponse<Readable>
  try {
    upstreamRes = await getUpstreamClient().post<Readable>(wire.url, capture.requestBody, {
      headers: wire.headers,
      responseType: 'stream',
      validateStatus: () => true,
      signal: controller.signal
    })
  } catch (err) {
    // signal 被 abort 只源于客户端断开：不回写，记 499（与透传路径一致）
    if (controller.signal.aborted) {
      res.destroy()
      finish({
        status: 499,
        stream: conversation.stream,
        usage: null,
        errorSnippet: 'client aborted',
        localResBody: null
      })
      return
    }
    // 网络层错误 message 已被 httpClient 拦截器增强（错误码 + 底层原因 + 中文提示）
    const message = `Upstream request failed: ${errMsg(err)}`
    const localResBody = entry.writeError(res, 502, message)
    finish({
      status: 502,
      stream: conversation.stream,
      usage: null,
      errorSnippet: message,
      localResBody
    })
    return
  }

  capture.responseHeaders = serializeResponseHeaders(responseHeadersOf(upstreamRes))

  // 非 2xx：读全量错误体，按真实状态码 + 入口协议信封返回（流式与否一致）
  if (upstreamRes.status >= 400) {
    const bodyText = await readAll(capture, upstreamRes.data, controller.signal)
    if (controller.signal.aborted) {
      res.destroy()
      finish({
        status: 499,
        stream: conversation.stream,
        usage: null,
        errorSnippet: 'client aborted',
        localResBody: null
      })
      return
    }
    const message = summarizeUpstreamError(upstreamRes.status, bodyText)
    entry.writeError(res, upstreamRes.status, message)
    finish({
      status: upstreamRes.status,
      stream: conversation.stream,
      usage: null,
      errorSnippet: message,
      localResBody: null
    })
    return
  }

  if (!conversation.stream) {
    await respondBuffered(
      ctx,
      entry,
      upstream,
      capture,
      upstreamRes.data,
      controller.signal,
      finish
    )
    return
  }
  await respondStreamed(ctx, entry, upstream, capture, upstreamRes.data, controller.signal, finish)
}

/** 非流式：读全量 JSON → 上游解码为统一结果 → 入口编码一次性回写 */
async function respondBuffered(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy,
  capture: WireCapture,
  upstreamData: Readable,
  signal: AbortSignal,
  finish: (outcome: ConversionOutcome) => void
): Promise<void> {
  const bodyText = await readAll(capture, upstreamData, signal)
  if (signal.aborted) {
    ctx.res.destroy()
    finish({
      status: 499,
      stream: false,
      usage: null,
      errorSnippet: 'client aborted',
      localResBody: null
    })
    return
  }
  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    const message = 'Upstream returned a non-JSON response'
    entry.writeError(ctx.res, 502, message)
    finish({ status: 502, stream: false, usage: null, errorSnippet: message, localResBody: null })
    return
  }
  const completion = upstream.decodeResponse(payload)
  const localResBody = entry.encodeCompletion(ctx.res, ctx.publicModel, completion)
  finish({
    status: 200,
    stream: false,
    usage: completion.usage ? toTokenUsage(completion.usage) : null,
    errorSnippet: null,
    localResBody
  })
}

/** 流式：上游解码 → 统一事件 → 入口编码回写（惰性响应头，可中途改道协议错误信封） */
async function respondStreamed(
  ctx: RequestContext,
  entry: ProtocolStrategy,
  upstream: ProtocolStrategy,
  capture: WireCapture,
  upstreamData: Readable,
  signal: AbortSignal,
  finish: (outcome: ConversionOutcome) => void
): Promise<void> {
  const encoder = entry.createEntryEncoder(ctx.res, ctx.publicModel)
  let usage: ApiUsage | null = null
  const decoder = upstream.createUpstreamDecoder(async (event) => {
    if (event.type === 'finish') usage = event.usage
    await encoder.write(event)
  })
  const parser = createSseParser()
  const sse = new TextDecoder()

  // 客户端断开（res close → abort）时销毁上游连接，读取循环随之终止
  const onAbort = (): void => {
    upstreamData.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    for await (const chunk of readChunks(upstreamData)) {
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
  if (decoder.done && !upstreamData.destroyed) upstreamData.destroy()

  if (signal.aborted) {
    ctx.res.destroy()
    finish({
      status: 499,
      stream: true,
      usage: null,
      errorSnippet: 'client aborted',
      localResBody: null
    })
    return
  }

  const failure = decoder.failure
  if (failure) {
    if (encoder.headWritten) {
      await encoder.writeError(failure.message)
      encoder.end()
    } else {
      entry.writeError(ctx.res, failure.status, failure.message)
    }
    finish({
      status: failure.status,
      stream: true,
      usage: null,
      errorSnippet: failure.message,
      localResBody: null
    })
    return
  }

  if (!decoder.completed) {
    // 上游流在终态事件前中断（连接提前关闭）
    const message = 'Upstream stream ended unexpectedly'
    if (encoder.headWritten) {
      await encoder.writeError(message)
      encoder.end()
    } else {
      entry.writeError(ctx.res, 502, message)
    }
    finish({ status: 502, stream: true, usage: null, errorSnippet: message, localResBody: null })
    return
  }

  encoder.end()
  finish({
    status: 200,
    stream: true,
    usage: usage ? toTokenUsage(usage) : null,
    errorSnippet: null,
    localResBody: null
  })
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
