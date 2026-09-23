import { randomUUID } from 'node:crypto'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { getServiceConfig } from '$/db/repo/settingRepo'
import { errMsg, sendOpenAiError } from './respond'
import { parseClientName, recordRequest } from './logging/requestLog'
import { handleListModels } from './routes/listModels'
import { handleChatCompletions } from './routes/chatCompletions'
import { handleMessages } from './routes/messages'
import { handleResponses } from './routes/responses'

/** 请求体上限：32MB，防异常大包拖垮内存 */
const MAX_BODY_BYTES = '32mb'

const parseJsonBody = express.json({ limit: MAX_BODY_BYTES })

/** 拦截行正文读取上限：够解析出模型与流式标记，又不为未鉴权请求无限缓冲 */
const INTERCEPT_BODY_MAX_BYTES = 1024 * 1024
/** 拦截行正文读取兜底超时：客户端迟迟不吐完正文时，401 也不能一直不回 */
const INTERCEPT_BODY_TIMEOUT_MS = 2000

/** 组装代理服务应用：CORS → 鉴权 → 路由 → 404 / 错误兜底 */
export function createProxyApp(): Express {
  const app = express()

  // CORS：预检直接放行（allow-headers 回显客户端申请的自定义头，如 x-session-id）；其余响应统一放行来源
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      const requested = req.headers['access-control-request-headers']
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers':
          typeof requested === 'string' && requested ? requested : '*',
        'access-control-max-age': '86400'
      })
      res.end()
      return
    }
    res.setHeader('access-control-allow-origin', '*')
    next()
  })

  // 全局 Key 鉴权：兼容 Authorization: Bearer 与 x-api-key；失败记日志后返回 401
  // （位于 express.json 之前：不为未鉴权请求解析 32MB 正文；正文改为有界读取，仅供日志排查）
  app.use((req, res, next) => {
    const apiKey = getServiceConfig().apiKey
    if (isAuthorized(req, apiKey)) {
      next()
      return
    }
    void rejectUnauthorized(req, res, apiKey)
  })

  app.get('/v1/models', handleListModels)

  // 对外暴露三个协议入口（OpenAI Chat / Anthropic Messages / OpenAI Responses）：
  // express.json 负责 body 解析与 32MB 上限（超限/非法 JSON 由错误兜底中间件转换）；
  // 入口协议 × 上游协议的组合在转发层消化，同协议走 raw 透传
  app.post('/v1/chat/completions', parseJsonBody, (req, res, next) => {
    handleChatCompletions(req, res).catch(next)
  })
  app.post('/v1/messages', parseJsonBody, (req, res, next) => {
    handleMessages(req, res).catch(next)
  })
  app.post('/v1/responses', parseJsonBody, (req, res, next) => {
    handleResponses(req, res).catch(next)
  })

  app.use((req, res) => {
    sendOpenAiError(res, 404, `Unknown API endpoint: ${req.method} ${req.path}`)
  })

  // 兜底错误处理：任何分支都不允许向客户端抛异常
  // （四参签名是 Express 识别错误中间件的依据，_next 不可省略）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = pickErrorStatus(err)
    if (status === 413) sendOpenAiError(res, 413, 'Request body too large')
    else if (status === 400) sendOpenAiError(res, 400, 'Request body is not valid JSON')
    else sendOpenAiError(res, 500, `Internal error: ${errMsg(err)}`)
  })

  return app
}

/**
 * 鉴权失败：读客户端正文（有界）后落一条可诊断的日志，再回 401 本地信封。
 *
 * 鉴权排在 body 解析之前，这一行本拿不到正文——但只有「状态码 + 客户端」的日志排查不出
 * 是哪个模型、哪个客户端配错了 Key。先读后回：响应结束后 socket 关闭，正文就再也读不到了。
 */
async function rejectUnauthorized(req: Request, res: Response, apiKey: string): Promise<void> {
  const startedAt = Date.now()
  const inbound = await readBodyPrefix(req)
  const parsed = parseJsonObject(inbound.text)
  const model = parsed?.['model']
  const resBody = sendOpenAiError(res, 401, 'Invalid API key provided', 'invalid_api_key')
  recordRequest({
    path: req.originalUrl,
    requestId: randomUUID(),
    publicModel: typeof model === 'string' && model ? model : '-',
    providerName: '-',
    upstreamModel: '-',
    providerId: null,
    modelId: null,
    client: parseClientName(req.headers['user-agent']),
    startedAt,
    status: 401,
    stream: parsed?.['stream'] === true,
    usage: null,
    error: describeAuthFailure(req, inbound, apiKey),
    // 本地拦截行：正文是客户端入站口径；客户端鉴权头不落库，只记形态与长度
    local: true,
    reqBody: inbound.text || null,
    reqHeaders: null,
    resBody,
    resHeaders: null,
    retryTrace: null
  })
}

interface InboundBody {
  /** 已收正文文本（可能因超上限或超时而不完整） */
  text: string
  /** 客户端声明的总长度（无 content-length 时为 null） */
  totalBytes: number | null
  /** 是否没读完（超上限或超时） */
  truncated: boolean
}

/** 读取客户端正文前缀（鉴权分支专用）：上限 1MB、兜底 2s，无正文的请求直接返回空串 */
function readBodyPrefix(req: Request): Promise<InboundBody> {
  const declared = Number(req.headers['content-length'] ?? '')
  const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : null
  if (totalBytes === null && req.headers['transfer-encoding'] === undefined) {
    return Promise.resolve({ text: '', totalBytes: null, truncated: false })
  }
  return new Promise<InboundBody>((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function finish(): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // 只摘数据监听：'end' / 'error' 留在流上兜底——提前收口后正文仍未读完，
      // 流再抛 error 时没有监听器会变成未捕获异常（finish 幂等，后到的事件自然空转）
      req.off('data', onData)
      resolve({ text: Buffer.concat(chunks).toString('utf-8'), totalBytes, truncated })
    }

    function onData(chunk: Buffer): void {
      if (size + chunk.length > INTERCEPT_BODY_MAX_BYTES) {
        truncated = true
        finish()
        return
      }
      chunks.push(chunk)
      size += chunk.length
    }

    timer = setTimeout(() => {
      truncated = true
      finish()
    }, INTERCEPT_BODY_TIMEOUT_MS)
    req.on('data', onData)
    req.once('end', finish)
    req.once('error', finish)
  })
}

/** 正文 JSON 解析：非对象或解析失败返回 null（拦截日志只取 model / stream，坏数据不阻断 401） */
function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 鉴权失败的排查信息：客户端带了什么鉴权头 + 正文收录情况。
 *
 * 只记形态与长度、**不落 Key 内容**：长度对不上即可区分「客户端拿的是另一个 Key」，
 * 与「头形态不对（如非 Bearer 前缀）」「根本没带鉴权头」两种配置错法。
 */
function describeAuthFailure(req: Request, inbound: InboundBody, apiKey: string): string {
  const auth = req.headers.authorization
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ')
  const authShape =
    typeof auth === 'string' && auth
      ? `${bearer ? 'Bearer' : '非 Bearer 形态'}（${(bearer ? auth.slice(7) : auth).length} 字符）`
      : '无'
  const xKey = req.headers['x-api-key']
  const xShape = typeof xKey === 'string' && xKey ? `有（${xKey.length} 字符）` : '无'
  const parts = [
    'invalid api key',
    `鉴权头: authorization=${authShape}, x-api-key=${xShape}（本地 Key ${apiKey.length} 字符）`
  ]
  if (inbound.truncated) {
    const limitMb = INTERCEPT_BODY_MAX_BYTES / 1024 / 1024
    parts.push(
      inbound.totalBytes === null
        ? `正文未收全（超 ${INTERCEPT_BODY_TIMEOUT_MS / 1000}s）`
        : `正文已截断（仅收录前 ${limitMb}MB / 共 ${(inbound.totalBytes / 1024 / 1024).toFixed(1)}MB）`
    )
  }
  return parts.join(' · ')
}

function isAuthorized(req: Request, apiKey: string): boolean {
  if (!apiKey) return false
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice(7) === apiKey)
    return true
  const xKey = req.headers['x-api-key']
  return typeof xKey === 'string' && xKey === apiKey
}

/** express.json 的 413（超限）/ 400（非法 JSON）等带 status 的错误，其余视为 500 */
function pickErrorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status: unknown = err.status
    if (typeof status === 'number' && status >= 400 && status < 600) return status
  }
  return 500
}
