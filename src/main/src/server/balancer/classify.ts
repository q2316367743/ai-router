/**
 * 上游失败归类：状态码 + 错误正文 → 尝试归类（决定扣不扣可用度、改不改道）。
 *
 * 分界只有一条：**上游服务/凭据/额度的问题要扣分并改道，请求本身的问题不扣分也不改道**
 * （把 400 当成渠道故障，一次参数写错就会把所有渠道一起拉黑）。
 */
import type { AttemptKind } from './types'

/** 额度类关键字：错误正文出现即按额度问题处理（宁可误阻断 10 分钟，也不继续给缺额度的渠道送流量） */
const QUOTA_KEYWORDS = [
  'insufficient_quota',
  'insufficient quota',
  'quota exceeded',
  'quota_exceeded',
  'exceeded your current quota',
  'out of credit',
  'no credit',
  'insufficient credit',
  'insufficient balance',
  'payment required',
  '欠费',
  '余额不足',
  '额度不足',
  '额度已用尽',
  '免费额度已用尽'
]

/**
 * 归类上游失败。`ok` / `client` 不会由此产生：前者是成功路径，后者来自客户端断开。
 * 网络层错误（无响应）由调用方直接判为 `upstream`。
 */
export function classifyFailure(status: number, bodyText: string): AttemptKind {
  const quotaish = looksLikeQuota(bodyText)
  if (status === 402) return 'quota'
  if (status === 408) return 'upstream'
  if (status === 429) return quotaish ? 'quota' : 'upstream'
  if (status === 401 || status === 403) return quotaish ? 'quota' : 'auth'
  if (status === 404) return 'missing'
  if (status >= 500) return 'upstream'
  if (status >= 400) return 'request'
  return 'ok'
}

/** 续跑判定：哪些归类值得换下一个渠道再试一次 */
export function isRetryable(kind: AttemptKind): boolean {
  return kind === 'upstream' || kind === 'auth' || kind === 'quota' || kind === 'missing'
}

/** 扣分判定：哪些归类说明渠道本身有问题（`missing` 是配置问题，不算渠道不健康） */
export function isPenalizing(kind: AttemptKind): kind is 'upstream' | 'auth' | 'quota' {
  return kind === 'upstream' || kind === 'auth' || kind === 'quota'
}

function looksLikeQuota(bodyText: string): boolean {
  if (!bodyText) return false
  const text = bodyText.toLowerCase()
  return QUOTA_KEYWORDS.some((keyword) => text.includes(keyword))
}
