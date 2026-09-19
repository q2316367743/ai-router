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
  // （位于 express.json 之前，此分支拿不到请求正文）
  app.use((req, res, next) => {
    if (isAuthorized(req, getServiceConfig().apiKey)) {
      next()
      return
    }
    const startedAt = Date.now()
    const resBody = sendOpenAiError(res, 401, 'Invalid API key provided', 'invalid_api_key')
    recordRequest({
      path: req.originalUrl,
      requestId: randomUUID(),
      publicModel: '-',
      providerName: '-',
      upstreamModel: '-',
      providerId: null,
      modelId: null,
      client: parseClientName(req.headers['user-agent']),
      startedAt,
      status: 401,
      stream: false,
      usage: null,
      error: 'invalid api key',
      // 未向提供商发起请求（线上口径请求侧为 null）；客户端鉴权头本就在脱敏剔除之列，无入库价值
      reqBody: null,
      reqHeaders: null,
      resBody,
      resHeaders: null
    })
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
