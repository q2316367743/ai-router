import type { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import type { AxiosResponse } from 'axios'
import {
  recordRequest,
  serializeOutboundHeaders,
  serializeResponseHeaders,
  startRequest
} from '../logging/requestLog'
import { errMsg } from '../respond'
import { pickForwardableHeaders } from '../upstream/forwardHeaders'
import { joinEndpointWithQuery, upstreamPathOf } from '../upstream/urls'
import { getUpstreamClient, responseHeadersOf } from '../upstream/httpClient'
import { createSseParser } from './sse'
import { toTokenUsage, type ApiUsage } from './conversation'
import type { ProtocolStrategy, RequestContext } from './types'

interface PassResult {
  usage: ApiUsage | null
  /** 非 2xx 时截取的响应片段（记入日志 error 字段） */
  errorSnippet: string | null
  /** 响应正文（流式为全部 SSE 文本），记入日志 responseBody */
  resBody: string | null
}

/**
 * 同协议转发：raw 直通。body 除 model 外原样保留，响应按上游 content-type
 * 判定流式 / 非流式原样回写（未知字段零损失）；usage 经上游协议解码器「抽头」收集，
 * 原文管道不受影响。entry 与 upstream 协议相同，错误信封二者通用。
 */
export async function passthrough(ctx: RequestContext, upstream: ProtocolStrategy): Promise<void> {
  const { body, res, route, publicModel, requestId, client, startedAt } = ctx
  // 同协议：纯透传，除 model 外全部原样保留
  body['model'] = route.upstreamName

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

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
  const forwardHeadersJson = serializeOutboundHeaders(forwardHeaders)

  // 转发前先落 pending 日志（日志页即时可见「进行中」）；stream 先按客户端意愿预估，
  // 结束时以实际上游 content-type 判定值回填
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
    requestHeaders: forwardHeadersJson
  })

  // validateStatus 全放行：非 2xx 也由下方透传给客户端（错误正文同样入库）
  let upstreamRes: AxiosResponse<Readable>
  try {
    upstreamRes = await getUpstreamClient().post<Readable>(upstreamUrl, forwardBody, {
      headers: forwardHeaders,
      responseType: 'stream',
      validateStatus: () => true,
      signal: controller.signal
    })
  } catch (err) {
    // signal 被 abort 只源于客户端断开：不回写，记 499（与转换路径一致）
    if (controller.signal.aborted) {
      res.destroy()
      finish(ctx, logPath, forwardBody, forwardHeadersJson, {
        status: 499,
        stream: clientStream,
        usage: null,
        error: 'client aborted',
        resBody: null,
        resHeaders: null
      })
      return
    }
    // 网络层错误 message 已被 httpClient 拦截器增强（错误码 + 底层原因 + 中文提示）
    const resBody = upstream.writeError(res, 502, `Upstream request failed: ${errMsg(err)}`)
    finish(ctx, logPath, forwardBody, forwardHeadersJson, {
      status: 502,
      stream: clientStream,
      usage: null,
      error: errMsg(err),
      resBody,
      resHeaders: null
    })
    return
  }

  const upstreamHeaders = responseHeadersOf(upstreamRes)
  const resHeaders = serializeResponseHeaders(upstreamHeaders)
  const isStream = (upstreamHeaders.get('content-type') ?? '').includes('text/event-stream')
  const pass = isStream
    ? await pipeStreamResponse(
        upstreamRes.data,
        upstreamRes.status,
        res,
        controller.signal,
        upstream
      )
    : await bufferResponse(upstreamRes.data, upstreamHeaders, upstreamRes.status, res, upstream)

  finish(ctx, logPath, forwardBody, forwardHeadersJson, {
    status: upstreamRes.status,
    stream: isStream,
    usage: pass.usage,
    error: pass.errorSnippet,
    resBody: pass.resBody,
    resHeaders
  })
}

/** 结束阶段统一落库（成功 / 失败 / 客户端断开） */
function finish(
  ctx: RequestContext,
  logPath: string,
  forwardBody: string,
  forwardHeadersJson: string | null,
  fields: {
    status: number
    stream: boolean
    usage: ApiUsage | null
    error: string | null
    resBody: string | null
    resHeaders: string | null
  }
): void {
  recordRequest({
    path: logPath,
    requestId: ctx.requestId,
    publicModel: ctx.publicModel,
    providerName: ctx.route.providerName,
    upstreamModel: ctx.route.upstreamName,
    providerId: ctx.route.providerId,
    modelId: ctx.route.modelId,
    client: ctx.client,
    startedAt: ctx.startedAt,
    ...fields,
    usage: fields.usage ? toTokenUsage(fields.usage) : null,
    reqBody: forwardBody,
    reqHeaders: forwardHeadersJson
  })
}

/** 非流式：读完上游 body 一次性原样返回；usage 从该协议解码器提取 */
async function bufferResponse(
  upstreamData: Readable,
  upstreamHeaders: Headers,
  status: number,
  res: ServerResponse,
  upstream: ProtocolStrategy
): Promise<PassResult> {
  const buf = await streamToBuffer(upstreamData)
  const body = buf.toString('utf-8')
  if (!res.writableEnded && !res.destroyed) {
    res.writeHead(status, {
      'content-type': upstreamHeaders.get('content-type') ?? 'application/json'
    })
    res.end(buf)
  }
  return {
    usage: jsonUsage(body, upstream),
    errorSnippet: status >= 200 && status < 300 ? null : body.slice(0, 500),
    resBody: body
  }
}

/** 流式：逐块原样回写（带背压）；同一份字节喂给抽头解码器收集 usage */
async function pipeStreamResponse(
  upstreamData: Readable,
  status: number,
  res: ServerResponse,
  signal: AbortSignal,
  upstream: ProtocolStrategy
): Promise<PassResult> {
  if (!res.writableEnded && !res.destroyed) {
    res.writeHead(status, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
  }
  // 客户端断开（res close → abort）时销毁上游连接，读循环随之终止
  const onAbort = (): void => {
    upstreamData.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  // 抽头：事件不回写客户端，只从 finish 事件收集 usage
  let usage: ApiUsage | null = null
  const decoder = upstream.createUpstreamDecoder(async (event) => {
    if (event.type === 'finish') usage = event.usage
  })

  const sse = new TextDecoder()
  const parser = createSseParser()
  const chunks: string[] = []
  let headText = ''
  try {
    for await (const chunk of readChunks(upstreamData)) {
      if (res.destroyed) break
      if (!res.write(chunk)) {
        // 客户端断开后 drain 永不触发，close 兜底放行（abort 已销毁上游，读循环随之终止）
        await new Promise<void>((resolve) => {
          res.once('drain', resolve)
          res.once('close', resolve)
        })
      }
      const text = sse.decode(chunk, { stream: true })
      chunks.push(text)
      if (headText.length < 500) headText += text
      for (const event of parser.feed(text)) {
        if (!decoder.done) await decoder.handleEvent(event)
      }
    }
    for (const event of parser.flush()) {
      if (!decoder.done) await decoder.handleEvent(event)
    }
    await decoder.flush()
  } catch {
    // 客户端断开（abort → destroy）或上游异常：终止透传即可
    res.destroy()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  res.end()
  return {
    usage,
    errorSnippet: status >= 200 && status < 300 ? null : headText.slice(0, 500),
    resBody: chunks.join('')
  }
}

/** 非流式 usage：借该协议的响应解码器提取（宽松实现，非 JSON 返回 null） */
function jsonUsage(body: string, upstream: ProtocolStrategy): ApiUsage | null {
  try {
    return upstream.decodeResponse(JSON.parse(body)).usage
  } catch {
    return null
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
