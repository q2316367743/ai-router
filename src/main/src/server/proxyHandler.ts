import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MappingRoute } from '$/db/repo/modelRepo'
import { findMapping } from '$/db/repo/modelRepo'
import { errMsg, sendOpenAiError } from './httpRespond'
import { addUsageQuietly, recordLocalLog, type TokenUsage } from './proxyLog'
import { forwardConverted } from './protocol/convertHandler'

interface PassResult {
  usage: TokenUsage | null
  /** 非 2xx 时截取的响应片段（记入日志 error 字段） */
  errorSnippet: string | null
}

/** 经 express.json 解析后的请求：转发层只依赖 body，不引入框架类型（避免与 fetch 的全局 Response 重名） */
type ProxyRequest = IncomingMessage & { body?: unknown }

/** POST /v1/chat/completions：校验 body → 查映射 → 按提供商协议透传或转换 → 日志/用量落库 */
export async function forwardRequest(req: ProxyRequest, res: ServerResponse): Promise<void> {
  const startedAt = Date.now()
  const path = req.url ?? '/'

  // express.json 已完成解析与 32MB 上限校验，此处只挡非对象 body（数组/标量）
  const parsed: unknown = req.body
  if (!isRecord(parsed)) {
    sendOpenAiError(res, 400, 'Request body is not valid JSON')
    return
  }
  const payload = parsed

  const publicModel = typeof payload['model'] === 'string' ? payload['model'] : ''
  if (!publicModel) {
    sendOpenAiError(res, 400, "'model' is required")
    return
  }

  const route = findMapping(publicModel)
  if (!route || !route.mappingEnabled || !route.providerEnabled) {
    sendOpenAiError(res, 404, `The model '${publicModel}' does not exist`, 'model_not_found')
    recordLocalLog({
      path,
      publicModel,
      providerName: route?.providerName ?? '-',
      upstreamModel: route?.upstreamName ?? '-',
      startedAt,
      status: 404,
      stream: false,
      usage: null,
      error: 'model not found or disabled'
    })
    return
  }

  // 异协议上游：OpenAI Chat 请求/响应与上游互转（ai-sdk 中间层）
  if (route.providerProtocol !== 'openai') {
    await forwardConverted(parsed, res, route, publicModel, startedAt)
    return
  }

  // 同协议（OpenAI Chat 兼容）：纯透传，除 model 外全部原样保留
  payload['model'] = route.upstreamName

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  let upstream: Response
  try {
    upstream = await fetch(joinUpstreamUrl(route.providerBaseUrl, path), {
      method: 'POST',
      headers: buildForwardHeaders(req, route),
      body: JSON.stringify(payload),
      signal: controller.signal
    })
  } catch (err) {
    sendOpenAiError(res, 502, `Upstream request failed: ${errMsg(err)}`)
    recordLocalLog({
      path,
      publicModel,
      providerName: route.providerName,
      upstreamModel: route.upstreamName,
      startedAt,
      status: 502,
      stream: false,
      usage: null,
      error: errMsg(err)
    })
    return
  }

  const isStream = (upstream.headers.get('content-type') ?? '').includes('text/event-stream')
  const pass = isStream
    ? await pipeStreamResponse(upstream, res)
    : await bufferResponse(upstream, res)

  recordLocalLog({
    path,
    publicModel,
    providerName: route.providerName,
    upstreamModel: route.upstreamName,
    startedAt,
    status: upstream.status,
    stream: isStream,
    usage: pass.usage,
    error: pass.errorSnippet
  })
  // 用量只在请求成功时累加（失败请求 tokens 不可信）
  if (upstream.ok) {
    addUsageQuietly(publicModel, pass.usage)
  }
}

/** 非流式：读完上游 body 一次性返回 */
async function bufferResponse(upstream: Response, res: ServerResponse): Promise<PassResult> {
  const buf = Buffer.from(await upstream.arrayBuffer())
  if (!res.writableEnded && !res.destroyed) {
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    })
    res.end(buf)
  }
  return {
    usage: extractJsonUsage(buf),
    errorSnippet: upstream.ok ? null : buf.toString('utf-8').slice(0, 500)
  }
}

/** 流式：逐块回写（带背压），边透传边从 SSE data 行提取 usage */
async function pipeStreamResponse(upstream: Response, res: ServerResponse): Promise<PassResult> {
  if (!res.writableEnded && !res.destroyed) {
    res.writeHead(upstream.status, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
  }
  const reader = upstream.body?.getReader()
  if (!reader) {
    res.end()
    return {
      usage: null,
      errorSnippet: upstream.ok ? 'empty upstream body' : 'upstream empty body'
    }
  }

  const decoder = new TextDecoder()
  const feeder = createSseUsageFeeder()
  let headText = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
      const text = decoder.decode(value, { stream: true })
      if (headText.length < 500) headText += text
      feeder.feed(text)
    }
  } catch {
    // 客户端断开（res close → abort）或上游异常：终止透传即可
    res.destroy()
  }
  res.end()
  return {
    usage: feeder.flush(),
    errorSnippet: upstream.ok ? null : headText.slice(0, 500)
  }
}

function buildForwardHeaders(req: IncomingMessage, route: MappingRoute): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${route.providerApiKey}` }
  const contentType = req.headers['content-type']
  if (typeof contentType === 'string') headers['content-type'] = contentType
  const accept = req.headers['accept']
  if (typeof accept === 'string') headers['accept'] = accept
  return headers
}

function joinUpstreamUrl(baseUrl: string, requestPath: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return requestPath.startsWith('/') ? `${trimmed}${requestPath}` : `${trimmed}/${requestPath}`
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

function extractJsonUsage(buf: Buffer): TokenUsage | null {
  try {
    const parsed: unknown = JSON.parse(buf.toString('utf-8'))
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
  let total = toCount(raw['total_tokens'])
  if (!total && (prompt || completion)) total = prompt + completion
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
