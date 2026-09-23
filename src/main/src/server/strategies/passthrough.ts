import type { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import type { AxiosResponse } from 'axios'
import {
  serializeOutboundHeaders,
  serializeResponseHeaders,
  startRequest
} from '../logging/requestLog'
import { pickForwardableHeaders } from '../upstream/forwardHeaders'
import { joinEndpointWithQuery, upstreamPathOf } from '../upstream/urls'
import { postUpstreamStream, responseHeadersOf } from '../upstream/httpClient'
import { classifyFailure } from '$/server/balancer'
import { createSseParser } from './sse'
import type { ApiUsage } from './conversation'
import type { AttemptOutcome, ProtocolStrategy, RequestContext } from './types'

/**
 * 同协议转发：raw 直通。body 除 model 外原样保留，响应按上游 content-type
 * 判定流式 / 非流式原样回写（未知字段零损失）；usage 经上游协议解码器「抽头」收集，
 * 原文管道不受影响。entry 与 upstream 协议相同，错误信封二者通用。
 *
 * **提交时机**（决定能否改道）：向客户端写出任何字节之前都不算提交——
 * - 非 2xx 先读全量错误体缓冲，不立即回写（让改道循环决定换渠道还是原样回放）；
 * - 流式响应头推迟到首个数据块到达时才写（「200 但一个字没吐就断」也能改道）。
 */
export async function passthrough(
  ctx: RequestContext,
  upstream: ProtocolStrategy
): Promise<AttemptOutcome> {
  const { body, res, route, publicModel, requestId, client, startedAt, controller } = ctx
  const signal = controller.signal
  // 同协议：纯透传，除 model 外全部原样保留
  body['model'] = route.upstreamName

  // 日志 path 记上游实际请求路径（而非客户端入口路径）
  const upstreamUrl = joinEndpointWithQuery(
    route.providerBaseUrl,
    upstream.upstreamPath,
    ctx.req.url ?? '/'
  )
  const logPath = upstreamPathOf(upstreamUrl)
  const clientStream = body['stream'] === true

  // 线上口径：日志记录实际发给提供商的正文与标头（标头入库前脱敏）
  const forwardBody = JSON.stringify(body)
  const forwardHeaders: Record<string, string> = {
    ...pickForwardableHeaders(ctx.req),
    ...upstream.upstreamAuthHeaders(route)
  }
  const wire = { body: forwardBody, headers: serializeOutboundHeaders(forwardHeaders) }

  // 转发前先落 pending 日志（日志页即时可见「进行中」）；stream 先按客户端意愿预估，
  // 结束时以实际上游 content-type 判定值回填
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
      stream: clientStream,
      requestBody: forwardBody,
      requestHeaders: wire.headers
    })
  }

  const call = await postUpstreamStream(upstreamUrl, forwardBody, forwardHeaders, signal)
  if (!call.ok) {
    if (call.reason === 'aborted') {
      return uncommitted({
        kind: 'client',
        status: 499,
        wire,
        path: logPath,
        message: 'client aborted',
        serve: null
      })
    }
    const message =
      call.reason === 'timeout' ? call.message : `Upstream request failed: ${call.message}`
    return uncommitted({
      kind: 'upstream',
      status: 502,
      wire,
      path: logPath,
      message,
      serve: () => upstream.writeError(res, 502, message)
    })
  }

  const upstreamRes = call.response
  const upstreamHeaders = responseHeadersOf(upstreamRes)
  const resHeaders = serializeResponseHeaders(upstreamHeaders)

  // 非 2xx：读全量错误体后**不立即回写**，交给改道循环（可改道时换渠道，无可改道时原样回放）
  if (upstreamRes.status >= 400) {
    const bodyText = await readAll(upstreamRes.data, signal)
    if (signal.aborted) {
      return uncommitted({
        kind: 'client',
        status: 499,
        wire,
        path: logPath,
        message: 'client aborted',
        serve: null
      })
    }
    const message = summarizeUpstreamError(upstreamRes.status, bodyText)
    return uncommitted({
      kind: classifyFailure(upstreamRes.status, bodyText),
      status: upstreamRes.status,
      upstreamStatus: upstreamRes.status,
      wire,
      path: logPath,
      message,
      serve: () => relayError(res, upstreamRes.status, upstreamHeaders, bodyText),
      resBody: bodyText,
      resHeaders
    })
  }

  if (!isEventStream(upstreamHeaders)) {
    let buf: Buffer
    try {
      buf = await streamToBuffer(upstreamRes.data)
    } catch {
      // 读正文中途断开：尚未向客户端写任何字节，仍可改道
      const message = 'Upstream stream ended unexpectedly'
      return uncommitted({
        kind: 'upstream',
        status: 502,
        upstreamStatus: upstreamRes.status,
        wire,
        path: logPath,
        message,
        serve: () => upstream.writeError(res, 502, message)
      })
    }
    const text = buf.toString('utf-8')
    const writable = !res.writableEnded && !res.destroyed
    if (writable) {
      res.writeHead(upstreamRes.status, {
        'content-type': upstreamHeaders.get('content-type') ?? 'application/json'
      })
      res.end(buf)
    }
    return {
      kind: 'ok',
      committed: writable,
      status: upstreamRes.status,
      upstreamStatus: upstreamRes.status,
      stream: false,
      path: logPath,
      usage: jsonUsage(text, upstream),
      wire,
      resBody: text,
      resHeaders,
      message: null,
      serve: null
    }
  }

  const chunks: string[] = []
  const streamed = await pipeStreamResponse(upstreamRes, res, signal, upstream, chunks)
  const message = streamed.message
  return {
    kind: streamed.kind,
    committed: streamed.committed,
    status: streamed.committed ? upstreamRes.status : 502,
    upstreamStatus: upstreamRes.status,
    stream: true,
    path: logPath,
    usage: streamed.usage,
    wire,
    resBody: chunks.join(''),
    resHeaders,
    message,
    // 首 token 前断流且无可改道时，用入口协议的错误信封收尾（否则客户端只会等到超时）
    serve:
      streamed.kind === 'upstream' && !streamed.committed && message
        ? () => upstream.writeError(res, 502, message)
        : null
  }
}

/** 未提交失败：本次尝试没向客户端写过任何字节，可改道；`serve` 供最后回放 */
function uncommitted(args: {
  kind: AttemptOutcome['kind']
  status: number
  wire: AttemptOutcome['wire']
  path: string
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
    stream: false,
    path: args.path,
    usage: null,
    wire: args.wire,
    resBody: args.resBody ?? null,
    resHeaders: args.resHeaders ?? null,
    message: args.message,
    serve: args.serve
  }
}

/** 上游错误报文原样回放（同协议下状态码与信封对客户端都合法） */
function relayError(
  res: ServerResponse,
  status: number,
  headers: Headers,
  bodyText: string
): string | null {
  if (res.writableEnded || res.destroyed) return null
  res.writeHead(status, {
    'content-type': headers.get('content-type') ?? 'application/json'
  })
  res.end(bodyText)
  return bodyText
}

interface StreamOutcome {
  kind: AttemptOutcome['kind']
  committed: boolean
  usage: ApiUsage | null
  message: string | null
}

/**
 * 流式：逐块原样回写（带背压）；同一份字节喂给抽头解码器收集 usage。
 *
 * 响应头在**首个数据块到达时**才写——上游 200 后一个字没吐就断开时，
 * 客户端还没收到任何字节，此时改道换渠道对客户端是透明的。
 */
async function pipeStreamResponse(
  upstreamRes: AxiosResponse<Readable>,
  res: ServerResponse,
  signal: AbortSignal,
  upstream: ProtocolStrategy,
  chunks: string[]
): Promise<StreamOutcome> {
  const data = upstreamRes.data
  // 客户端断开（signal abort）时销毁上游连接，读循环随之终止
  const onAbort = (): void => {
    data.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  // 抽头：事件不回写客户端，只从 finish 事件收集 usage
  let usage: ApiUsage | null = null
  const decoder = upstream.createUpstreamDecoder(async (event) => {
    if (event.type === 'finish') usage = event.usage
  })

  const sse = new TextDecoder()
  const parser = createSseParser()
  let headWritten = false
  let broke = false
  try {
    for await (const chunk of readChunks(data)) {
      if (res.destroyed) break
      if (!headWritten) {
        headWritten = true
        if (!res.writableEnded) {
          res.writeHead(upstreamRes.status, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive'
          })
        }
      }
      if (!res.write(chunk)) {
        // 客户端断开后 drain 永不触发，close 兜底放行（abort 已销毁上游，读循环随之终止）
        await new Promise<void>((resolve) => {
          res.once('drain', resolve)
          res.once('close', resolve)
        })
      }
      const text = sse.decode(chunk, { stream: true })
      chunks.push(text)
      for (const event of parser.feed(text)) {
        if (!decoder.done) await decoder.handleEvent(event)
      }
    }
    for (const event of parser.flush()) {
      if (!decoder.done) await decoder.handleEvent(event)
    }
    await decoder.flush()
  } catch {
    // 客户端断开（abort → destroy）或上游异常：下方按 aborted / 流中断收口
    broke = true
  } finally {
    signal.removeEventListener('abort', onAbort)
  }

  if (signal.aborted) {
    return { kind: 'client', committed: headWritten, usage: null, message: 'client aborted' }
  }
  // 上游读取抛错：已提交时只能断流（与改造前一致，客户端看到连接被重置）
  if (broke) {
    if (headWritten && !res.destroyed) res.destroy()
    return {
      kind: 'upstream',
      committed: headWritten,
      usage,
      message: 'Upstream stream ended unexpectedly'
    }
  }
  if (!res.writableEnded && !res.destroyed) res.end()
  // 上游干净关闭但没给终态事件：收尾后由日志与流内错误帧暴露「提前中断」
  if (!decoder.completed) {
    return {
      kind: 'upstream',
      committed: headWritten,
      usage,
      message: 'Upstream stream ended unexpectedly'
    }
  }
  return { kind: 'ok', committed: true, usage, message: null }
}

function isEventStream(headers: Headers): boolean {
  return (headers.get('content-type') ?? '').includes('text/event-stream')
}

/** 非流式 usage：借该协议的响应解码器提取（宽松实现，非 JSON 返回 null） */
function jsonUsage(body: string, upstream: ProtocolStrategy): ApiUsage | null {
  try {
    return upstream.decodeResponse(JSON.parse(body)).usage
  } catch {
    return null
  }
}

/** 上游错误响应摘要：状态码 + 正文片段（日志与重试轨迹共用） */
function summarizeUpstreamError(status: number, bodyText: string): string {
  const snippet = bodyText.slice(0, 500)
  return snippet
    ? `Upstream request failed with status ${status}: ${snippet}`
    : `Upstream request failed with status ${status}`
}

/** 读全量上游正文（abort 时销毁流终止读取，保留已收部分） */
async function readAll(stream: Readable, signal: AbortSignal): Promise<string> {
  const onAbort = (): void => {
    stream.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const buf = await streamToBuffer(stream)
    return buf.toString('utf-8')
  } catch {
    return ''
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** 消费上游流为 Buffer（data/error 事件驱动，避免 async iterator 的隐式 any） */
function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/** Readable 的 async iterator 声明为 any，收窄为 Buffer 后再参与后续处理 */
async function* readChunks(stream: Readable): AsyncGenerator<Buffer> {
  for await (const chunk of stream) yield chunk as Buffer
}
