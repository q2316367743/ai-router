import dayjs from 'dayjs'

export { formatTokens, tokenParts } from '@common/utils/format'

/** 毫秒时间戳 → HH:mm:ss */
export function formatTime(ms: number): string {
  return dayjs(ms).format('HH:mm:ss')
}

/** 毫秒时间戳 → MM-DD HH:mm:ss（日志列表跨天展示） */
export function formatDateTime(ms: number): string {
  return dayjs(ms).format('MM-DD HH:mm:ss')
}

/** 毫秒 → 秒（两位小数），日志耗时的统一展示口径；进行中（null）显示占位 */
export function formatDuration(ms: number | null): string {
  return ms == null ? '-' : `${(ms / 1000).toFixed(2)}s`
}

/** 毫秒时间戳 → 相对时间（刚刚 / N分钟前 / N小时前 / N天前），「更新于…」类文案用；
 *  now 可显式传入（定时刷新的场景由调用方给一个每分钟走一次的基准，避免文案停住） */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

/** 2xx（含 200/206/209 等）视为成功；进行中（null）不算成功 */
export function isSuccessStatus(status: number | null): boolean {
  return status != null && status >= 200 && status < 300
}

/** 状态码为空即请求进行中（pending 行：finishedAt / status / durationMs 均为 null） */
export function isPendingStatus(status: number | null): boolean {
  return status == null
}

/** API Key 脱敏：sk-abcd…wxyz */
export function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

/** HTTP 状态码 → t-tag theme */
export function statusTheme(status: number): 'success' | 'warning' | 'danger' {
  if (status < 400) return 'success'
  if (status < 500) return 'warning'
  return 'danger'
}
