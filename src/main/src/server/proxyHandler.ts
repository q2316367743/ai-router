import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import type { AxiosResponse } from 'axios'
import { findMapping } from '$/db/repo/modelRepo'
import { errMsg, sendOpenAiError } from './httpRespond'
import { buildForwardHeaders, collectExtraHeaders } from './forwardHeaders'
import {
  parseClientName,
  recordRequest,
  serializeOutboundHeaders,
  serializeResponseHeaders,
  startRequest,
  type TokenUsage
} from './proxyLog'
import { forwardConverted } from './protocol/convertHandler'
import { joinChatCompletionsUrl, upstreamPathOf } from './protocol/upstreamUrl'
import { getUpstreamClient, responseHeadersOf } from './upstreamHttp'

interface PassResult {
  usage: TokenUsage | null
  /** 非 2xx 时截取的响应片段（记入日志 error 字段） */
  errorSnippet: string | null
  /** 响应正文（流式为全部 SSE 文本），记入日志 responseBody */
  resBody: string | null
}

/** 经 express.json 解析后的请求：转发层只依赖 body，不引入框架类型（避免与 fetch 的全局 Response 重名） */
type ProxyRequest = IncomingMessage & { body?: unknown }

/** POST /v1/chat/completions：校验 body → 查映射 → 按提供商协议透传或转换 → 日志/用量落库 */
export async function forwardRequest(req: ProxyRequest, res: ServerResponse): Promise<void> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  const path = req.url ?? '/'
  // 来源客户端在入口解析一次：本地拦截与转发各分支共用，且早于任何早返回
  const client = parseClientName(req.headers['user-agent'])

  // express.json 已完成解析与 32MB 上限校验，此处只挡非对象 body（数组/标量）
  const parsed: unknown = req.body
  if (!isRecord(parsed)) {
    const resBody = sendOpenAiError(res, 400, 'Request body is not valid JSON')
    recordRequest({
      path,
      requestId,
      publicModel: '-',
      providerName: '-',
      upstreamModel: '-',
      providerId: null,
      modelId: null,
      client,
      startedAt,
      status: 400,
      stream: false,
      usage: null,
      error: 'invalid request body',
      reqBody: null,
      reqHeaders: null,
      resBody,
      resHeaders: null
    })
    return
  }

  const publicModel = typeof parsed['model'] === 'string' ? parsed['model'] : ''
  if (!publicModel) {
    const resBody = sendOpenAiError(res, 400, "'model' is required")
    recordRequest({
      path,
      requestId,
      publicModel: '-',
      providerName: '-',
      upstreamModel: '-',
      providerId: null,
      modelId: null,
      client,
      startedAt,
      status: 400,
      stream: false,
      usage: null,
      error: "'model' is required",
      // 日志为线上口径：未向提供商发起请求，出站请求侧记 null
      reqBody: null,
      reqHeaders: null,
      resBody,
      resHeaders: null
    })
    return
  }

  const route = findMapping(publicModel)
  // 已归档（映射自身或所属提供商）与「不存在 / 已禁用」区分报错：归档是对客户端的正式下线
  // 宣告，明确告知；禁用仍沿用不区分口径的 404，不泄漏配置
  const archived =
    route !== null && (route.mappingArchivedAt !== null || route.providerArchivedAt !== null)
  if (!route || archived || !route.mappingEnabled || !route.providerEnabled) {
    const resBody = sendOpenAiError(
      res,
      404,
      archived
        ? `The model '${publicModel}' has been archived`
        : `The model '${publicModel}' does not exist`,
      archived ? 'model_archived' : 'model_not_found'
    )
    recordRequest({
      path,
      requestId,
      publicModel,
      providerName: route?.providerName ?? '-',
      upstreamModel: route?.upstreamName ?? '-',
      providerId: route?.providerId ?? null,
      modelId: route?.modelId ?? null,
      client,
      startedAt,
      status: 404,
      stream: false,
      usage: null,
      error: archived ? 'model archived' : 'model not found or disabled',
      reqBody: null,
      reqHeaders: null,
      resBody,
      resHeaders: null
    })
    return
  }

  // 异协议上游：OpenAI Chat 请求/响应与上游互转（ai-sdk 中间层）
  if (route.providerProtocol !== 'openai') {
    await forwardConverted({
      body: parsed,
      res,
      route,
      publicModel,
      requestId,
      client,
      startedAt,
      extraHeaders: collectExtraHeaders(req)
    })
    return
  }

  // 同协议（OpenAI Chat 兼容）：纯透传，除 model 外全部原样保留
  parsed['model'] = route.upstreamName

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  const upstreamUrl = joinChatCompletionsUrl(route.providerBaseUrl, path)
  // 日志 path 记上游实际请求路径（而非客户端入口路径）
  const logPath = upstreamPathOf(upstreamUrl)
  const clientStream = parsed['stream'] === true

  // 线上口径：日志记录实际发给提供商的正文与标头（标头入库前脱敏）
  const forwardBody = JSON.stringify(parsed)
  const forwardHeaders = buildForwardHeaders(req, route)
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
  let upstream: AxiosResponse<Readable>
  try {
    upstream = await getUpstreamClient().post<Readable>(upstreamUrl, forwardBody, {
      headers: forwardHeaders,
      responseType: 'stream',
      validateStatus: () => true,
      signal: controller.signal
    })
  } catch (err) {
    // signal 被 abort 只源于客户端断开：不回写，记 499（与转换路径一致）
    if (controller.signal.aborted) {
      res.destroy()
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
        status: 499,
        stream: clientStream,
        usage: null,
        error: 'client aborted',
        reqBody: forwardBody,
        reqHeaders: forwardHeadersJson,
        resBody: null,
        resHeaders: null
      })
      return
    }
    // 网络层错误 message 已被 upstreamHttp 拦截器增强（错误码 + 底层原因 + 中文提示）
    const resBody = sendOpenAiError(res, 502, `Upstream request failed: ${errMsg(err)}`)
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
        status: 502,
      stream: clientStream,
      usage: null,
      error: errMsg(err),
      reqBody: forwardBody,
      reqHeaders: forwardHeadersJson,
      resBody,
      resHeaders: null
    })
    return
  }

  const upstreamHeaders = responseHeadersOf(upstream)
  const resHeaders = serializeResponseHeaders(upstreamHeaders)
  const isStream = (upstreamHeaders.get('content-type') ?? '').includes('text/event-stream')
  const pass = isStream
    ? await pipeStreamResponse(upstream.data, upstream.status, res, controller.signal)
    : await bufferResponse(upstream, upstreamHeaders, res)

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
    status: upstream.status,
    stream: isStream,
    usage: pass.usage,
    error: pass.errorSnippet,
    reqBody: forwardBody,
    reqHeaders: forwardHeadersJson,
    resBody: pass.resBody,
    resHeaders
  })
}

/** 非流式：读完上游 body 一次性返回 */
async function bufferResponse(
  upstream: AxiosResponse<Readable>,
  upstreamHeaders: Headers,
  res: ServerResponse
): Promise<PassResult> {
  const buf = await streamToBuffer(upstream.data)
  const body = buf.toString('utf-8')
  if (!res.writableEnded && !res.destroyed) {
    res.writeHead(upstream.status, {
      'content-type': upstreamHeaders.get('content-type') ?? 'application/json'
    })
    res.end(buf)
  }
  return {
    usage: extractJsonUsage(body),
    errorSnippet: upstream.status >= 200 && upstream.status < 300 ? null : body.slice(0, 500),
    resBody: body
  }
}

/** 流式：逐块回写（带背压），边透传边累积完整 SSE 文本并提取 usage */
async function pipeStreamResponse(
  upstream: Readable,
  status: number,
  res: ServerResponse,
  signal: AbortSignal
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
    upstream.destroy()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  const decoder = new TextDecoder()
  const feeder = createSseUsageFeeder()
  const chunks: string[] = []
  let headText = ''
  try {
    for await (const chunk of readChunks(upstream)) {
      if (res.destroyed) break
      if (!res.write(chunk)) {
        // 客户端断开后 drain 永不触发，close 兜底放行（abort 已销毁上游，读循环随之终止）
        await new Promise<void>((resolve) => {
          res.once('drain', resolve)
          res.once('close', resolve)
        })
      }
      const text = decoder.decode(chunk, { stream: true })
      chunks.push(text)
      if (headText.length < 500) headText += text
      feeder.feed(text)
    }
  } catch {
    // 客户端断开（abort → destroy）或上游异常：终止透传即可
    res.destroy()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  res.end()
  return {
    usage: feeder.flush(),
    errorSnippet: status >= 200 && status < 300 ? null : headText.slice(0, 500),
    resBody: chunks.join('')
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

/** SSE usage 提取器：按完整行解析 data: 行，取最后一个非空 usage */
function createSseUsageFeeder(): { feed(text: string): void; flush(): TokenUsage | null } {
  let buffer = ''
  let usage: TokenUsage | null = null
  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      const parsed: unknown = JSON.parse(data)
      if (isRecord(parsed) && parsed['usage'] != null) {
        usage = normalizeUsage(parsed['usage']) ?? usage
      }
    } catch {
      // 半行或非 JSON 片段，忽略
    }
  }
  return {
    feed(text: string) {
      buffer += text
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 1)
        idx = buffer.indexOf('\n')
      }
    },
    flush() {
      if (buffer.trim()) handleLine(buffer)
      buffer = ''
      return usage
    }
  }
}

function extractJsonUsage(body: string): TokenUsage | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed) && parsed['usage'] != null) return normalizeUsage(parsed['usage'])
  } catch {
    // 响应体非 JSON，忽略
  }
  return null
}

function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!isRecord(raw)) return null
  const prompt = toCount(raw['prompt_tokens'])
  const completion = toCount(raw['completion_tokens'])
  const promptDetails = isRecord(raw['prompt_tokens_details']) ? raw['prompt_tokens_details'] : {}
  const completionDetails = isRecord(raw['completion_tokens_details'])
    ? raw['completion_tokens_details']
    : {}
  const usage: TokenUsage = {
    promptTokens: prompt,
    completionTokens: completion,
    reasoningTokens:
      toCount(completionDetails['reasoning_tokens']) || toCount(raw['reasoning_tokens']),
    cacheReadTokens:
      toCount(promptDetails['cached_tokens']) || toCount(raw['cache_read_input_tokens']),
    cacheWriteTokens: toCount(raw['cache_creation_input_tokens']),
    totalTokens: toCount(raw['total_tokens'])
  }
  if (!usage.totalTokens) usage.totalTokens = prompt + completion
  return usage
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
