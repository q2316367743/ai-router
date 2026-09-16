/**
 * 上游端点解析：统一约定「提供商 baseUrl = 完整 API 根」，两条路径共享同一语义。
 *
 * - baseUrl 已含版本/路径前缀（`/v1`、`/api/plan/v3`、中转站自定义前缀等），不做版本推断；
 * - 透传路径（`openai`）固定在其后接 `/chat/completions`；
 * - 转换路径（`openai-responses` / `anthropic`）由 ai-sdk 接 `/responses`、`/messages`，仅需 baseUrl。
 */
import type { ProviderProtocol } from '@common/types'

/** 规范化 baseUrl：去首尾空白与结尾斜杠（不补版本段） */
export function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.trim().replace(/\/+$/, '')
}

/** 透传路径上游端点：API 根 + /chat/completions（保留入站 query） */
export function joinChatCompletionsUrl(baseUrl: string, requestPath: string): string {
  const queryIndex = requestPath.search(/[?#]/)
  const query = queryIndex === -1 ? '' : requestPath.slice(queryIndex)
  return `${normalizeBaseUrl(baseUrl)}/chat/completions${query}`
}

/** 转换路径上游端点：API 根 + /messages（Anthropic）或 /responses（Responses） */
export function joinConvertUrl(baseUrl: string, protocol: ProviderProtocol): string {
  const endpoint = protocol === 'anthropic' ? '/messages' : '/responses'
  return `${normalizeBaseUrl(baseUrl)}${endpoint}`
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
