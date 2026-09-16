import dayjs from 'dayjs'

export { formatTokens } from '@common/utils/format'

/** 毫秒时间戳 → HH:mm:ss */
export function formatTime(ms: number): string {
  return dayjs(ms).format('HH:mm:ss')
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
