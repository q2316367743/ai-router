import dayjs from 'dayjs'

/** 本地时区日期键（YYYY-MM-DD），日志清理与用量聚合的统一口径 */
export function todayKey(): string {
  return dayjs().format('YYYY-MM-DD')
}

/** 指定时间戳的本地时区日期键（YYYY-MM-DD），日志归属日期的推导口径 */
export function dateKey(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD')
}
