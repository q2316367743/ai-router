import { cleanupExpiredHourly } from '$/db/repo/usageRepo'
import type { SchedulerJob } from '../job'

/** 每天 04:40（本地时区）：小时桶保留 7 天，与日志清理错开 */
const CRON = '0 40 4 * * *'
/** 启动首跑延时：错开日志清扫的首跑，避免启动瞬间连跑两条清理语句 */
const STARTUP_DELAY_MS = 2_000

/**
 * 用量小时桶清理：删掉保留窗口之外的行（日粒度表永久保留，不动）。
 * 原先挂在每个请求的聚合写入末尾，改为定时任务后写路径不再承担维护职责。
 */
export const usageRetentionJob: SchedulerJob = {
  id: 'usage:retention',
  cron: CRON,
  startupDelayMs: STARTUP_DELAY_MS,
  run: cleanupExpiredHourly
}
