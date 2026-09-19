/**
 * 上游端点解析：统一约定「提供商 baseUrl = 完整 API 根」，三条策略共用同一语义。
 *
 * - baseUrl 已含版本/路径前缀（`/v1`、`/api/plan/v3`、中转站自定义前缀等），不做版本推断；
 * - 端点路径由各协议策略提供（`/chat/completions`、`/messages`、`/responses`），此处只做拼接。
 */

/** 规范化 baseUrl：去首尾空白与结尾斜杠（不补版本段） */
export function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.trim().replace(/\/+$/, '')
}

/** 上游端点：API 根 + 协议端点路径（转换路径用） */
export function joinEndpoint(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`
}

/** 上游端点（透传用）：API 根 + 协议端点路径，入站 query 原样保留 */
export function joinEndpointWithQuery(baseUrl: string, path: string, requestPath: string): string {
  const queryIndex = requestPath.search(/[?#]/)
  const query = queryIndex === -1 ? '' : requestPath.slice(queryIndex)
  return `${normalizeBaseUrl(baseUrl)}${path}${query}`
}

/** 取上游 URL 的路径部分（含 query）用于日志；不可解析时原样返回 */
export function upstreamPathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url)
    return `${pathname}${search}`
  } catch {
    return url
  }
}
