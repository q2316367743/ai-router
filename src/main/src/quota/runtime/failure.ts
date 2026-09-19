/**
 * 策略失败分类：复刻 CodexBar `__CODEXBAR_FAILURE_V2__:<kind>:<retryAfter>:<message>`
 * 约定——脚本经 ctx.fail 抛出的错误带此前缀，宿主解析后还原为结构化失败并映射中文文案。
 */
import type { QuotaClassifiedFailure, QuotaFailureKind } from '@common/types'

const FAILURE_PREFIX = '__CODEXBAR_FAILURE_V2__:'

const KINDS: readonly QuotaFailureKind[] = [
  'authentication-expired',
  'missing-credential',
  'permission-denied',
  'parse-failure',
  'rate-limited',
  'provider-unavailable',
  'network-failure',
  'api-failure'
]

/** 分类 → 中文文案（IPC/快照 error 字段直接展示） */
const KIND_LABELS: Readonly<Record<QuotaFailureKind, string>> = {
  'authentication-expired': '凭证已过期，请更新 API Key / Cookie / 令牌',
  'missing-credential': '缺少凭证（未配置 API Key 或 Cookie）',
  'permission-denied': '无权限访问（凭证有效但被拒绝）',
  'parse-failure': '响应解析失败（上游返回了非预期的内容）',
  'rate-limited': '请求过于频繁，已被限流',
  'provider-unavailable': '上游服务暂不可用',
  'network-failure': '网络请求失败',
  'api-failure': '上游接口报错'
}

/** 构造分类失败错误（ctx.fail 各方法的实现） */
export function makeFailure(kind: QuotaFailureKind, message: string): Error {
  return new Error(`${FAILURE_PREFIX}${kind}::${message}`)
}

/**
 * 从任意抛出物解析分类失败：命中前缀且 kind 合法 → 结构化失败；否则 null（按普通错误处理）。
 * 格式为 4 段（kind 与 retryAfter 以 `:` 分隔，message 允许含冒号），retryAfter 本实现不消费。
 */
export function parseFailure(err: unknown): QuotaClassifiedFailure | null {
  if (!(err instanceof Error)) return null
  const message = err.message
  if (!message.startsWith(FAILURE_PREFIX)) return null
  const rest = message.slice(FAILURE_PREFIX.length)
  const first = rest.indexOf(':')
  const second = first === -1 ? -1 : rest.indexOf(':', first + 1)
  if (first === -1 || second === -1) return null
  const kind = rest.slice(0, first) as QuotaFailureKind
  if (!KINDS.includes(kind)) return null
  return { kind, message: rest.slice(second + 1) || KIND_LABELS[kind] }
}

/** 任意抛出物 → 展示文案：分类失败用「中文文案：原始信息」，普通错误直接用 message */
export function describeError(err: unknown): string {
  const failure = parseFailure(err)
  const raw = err instanceof Error ? err.message : String(err)
  if (failure) {
    const label = KIND_LABELS[failure.kind]
    return failure.message && failure.message !== label ? `${label}：${failure.message}` : label
  }
  return raw
}
