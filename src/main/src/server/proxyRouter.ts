import { randomUUID } from 'node:crypto'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { listModelMappings } from '$/db/repo/modelRepo'
import { getServiceConfig } from '$/db/repo/settingRepo'
import { errMsg, sendJson, sendOpenAiError } from './httpRespond'
import { recordRequest } from './proxyLog'
import { forwardRequest } from './proxyHandler'

/** 请求体上限：32MB，防异常大包拖垮内存 */
const MAX_BODY_BYTES = '32mb'

/** 组装代理服务应用：CORS → 鉴权 → 路由 → 404 / 错误兜底 */
export function createProxyApp(): Express {
  const app = express()

  // CORS：预检直接放行（allow-headers 回显客户端申请的自定义头，如 x-session-id）；其余响应统一放行来源
  app.use((req, res, next) => {
    console.log(req.path)
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

  // 对外仅暴露 OpenAI Chat Completions：express.json 负责 body 解析与 32MB 上限
  // （超限/非法 JSON 由错误兜底中间件转换）；异协议上游在 forwardRequest 内走转换路径
  app.post('/v1/chat/completions', express.json({ limit: MAX_BODY_BYTES }), (req, res, next) => {
    forwardRequest(req, res).catch(next)
  })

  app.use((req, res) => {
    sendOpenAiError(res, 404, `Unknown API endpoint: ${req.method} ${req.path}`)
  })

  // 兜底错误处理：任何分支都不允许向客户端抛异常
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = pickErrorStatus(err)
    if (status === 413) sendOpenAiError(res, 413, 'Request body too large')
    else if (status === 400) sendOpenAiError(res, 400, 'Request body is not valid JSON')
    else sendOpenAiError(res, 500, `Internal error: ${errMsg(err)}`)
  })

  return app
}

/** GET /v1/models：返回对外模型列表（启用且未归档，且所属提供商未归档） */
function handleListModels(_req: Request, res: Response): void {
  const data = listModelMappings()
    .filter((m) => m.enabled && m.archivedAt === null && m.providerArchivedAt === null)
    .map((m) => ({
      id: m.publicName,
      object: 'model',
      created: Math.floor(m.createdAt / 1000),
      owned_by: m.providerName
    }))
  sendJson(res, 200, { object: 'list', data })
}

function isAuthorized(req: Request, apiKey: string): boolean {
  if (!apiKey) return false
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice(7) === apiKey) return true
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
