/**
 * 内置 TS 策略共享解析工具：上游 JSON 宽松取值（多候选字段名取第一个存在的），
 * 对齐 CodexBar fetcher 的 percentKeys/resetInKeys 模式，容忍各家字段命名差异。
 */

export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function numOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function strOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 严格整数（不接受数字字符串，区别于 numOf） */
export function intOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** 依次取候选键中第一个有值的字段 */
export function pick(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

const PERCENT_KEYS = [
  'usagePercent',
  'usedPercent',
  'percentUsed',
  'percent',
  'usage_percent',
  'used_percent',
  'utilization'
]
const USED_KEYS = ['used', 'usage', 'consumed', 'count', 'usedTokens', 'requestsUsed']
const LIMIT_KEYS = [
  'limit',
  'total',
  'quota',
  'max',
  'cap',
  'tokenLimit',
  'request_limit',
  'hard_limit'
]
const RESET_IN_KEYS = ['resetInSec', 'resetInSeconds', 'resetSeconds', 'reset_in_sec', 'resetSec']
const RESET_AT_KEYS = ['resetAt', 'resetsAt', 'reset_at', 'resets_at', 'nextReset', 'next_reset']

/** 窗口百分比：显式 percent 字段（≤1 视为小数比例）或 used/limit 计算 */
export function percentOf(record: Record<string, unknown> | null): number | null {
  const direct = numOf(pick(record, PERCENT_KEYS))
  if (direct !== null) return direct <= 1 ? direct * 100 : direct
  const used = numOf(pick(record, USED_KEYS))
  const limit = numOf(pick(record, LIMIT_KEYS))
  if (used !== null && limit !== null && limit > 0) return (used / limit) * 100
  return null
}

/** 重置时刻（epoch ms）：resetInSec 倒计时或 resetAt 时间戳（秒/毫秒自适配） */
export function resetsAtOf(
  record: Record<string, unknown> | null,
  now = Date.now()
): number | null {
  const inSec = numOf(pick(record, RESET_IN_KEYS))
  if (inSec !== null && inSec >= 0) return now + inSec * 1000
  const at = numOf(pick(record, RESET_AT_KEYS))
  if (at !== null && at > 0) return at < 1e12 ? at * 1000 : at
  return null
}
