import dayjs from 'dayjs'

/** 本地时区日期键（YYYY-MM-DD），日志清理与用量聚合的统一口径 */
export function todayKey(): string {
  return dayjs().format('YYYY-MM-DD')
}

/** 指定时间戳的本地时区日期键（YYYY-MM-DD），日志归属日期的推导口径 */
export function dateKey(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD')
}

/** 指定时间戳的本地时区小时键（YYYY-MM-DDTHH），用量小时聚合桶 */
export function hourKey(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DDTHH')
}

/** 展示用小时刻度标签（HH:00） */
export function hourLabel(key: string): string {
  return `${key.slice(11, 13)}:00`
}

/** 展示用日期刻度标签（MM-DD） */
export function dayLabel(key: string): string {
  return key.slice(5)
}
