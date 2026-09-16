import type { IncomingMessage } from 'node:http'
import type { MappingRoute } from '$/db/repo/modelRepo'

/**
 * 转发上游时必须剥离的请求头：
 * - 逐跳 / 传输头：fetch 会自行生成（或不容许出现），转发旧值反而出错（如 content-length 在改写 body 后失配）
 * - 代理自身鉴权与会话头：authorization / x-api-key 携带的是客户端访问本代理的 Key，转发会把本地 Key 泄漏给上游
 * - accept-encoding 交给 fetch/undici 自行协商压缩
 */
const EXCLUDED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'content-length',
  'accept-encoding',
  'authorization',
  'x-api-key',
  'cookie'
])

/** 提取可透传的客户端请求头：UA、x-request-id、x-session-id、anthropic-beta 等业务自定义头原样保留 */
export function pickForwardableHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (EXCLUDED_HEADERS.has(name)) continue
    if (typeof value === 'string') headers[name] = value
    else if (Array.isArray(value)) headers[name] = value.join(', ')
  }
  return headers
}

/** 透传路径出站头：客户端头全量透传，authorization 替换为上游 Key */
export function buildForwardHeaders(
  req: IncomingMessage,
  route: MappingRoute
): Record<string, string> {
  return {
    ...pickForwardableHeaders(req),
    authorization: `Bearer ${route.providerApiKey}`
  }
}

/** 转换路径附加头：content-type / accept 与认证头由 ai-sdk 按上游协议自建，其余客户端头经 headers 选项附带 */
export function collectExtraHeaders(req: IncomingMessage): Record<string, string> {
  const headers = pickForwardableHeaders(req)
  delete headers['content-type']
  delete headers['accept']
  return headers
}
