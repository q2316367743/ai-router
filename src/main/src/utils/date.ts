import dayjs from 'dayjs'

/** 本地时区日期键（YYYY-MM-DD），日志清理与用量聚合的统一口径 */
export function todayKey(): string {
  return dayjs().format('YYYY-MM-DD')
}
