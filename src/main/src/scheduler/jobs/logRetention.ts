import { cleanupExpiredLogs } from '$/db/repo/logRepo'
import type { SchedulerJob } from '../job'

/** 每天 04:30（本地时区）：行保留 7 天、正文保留 12 小时 */
const CRON = '0 30 4 * * *'

/**
 * 日志保留清理：删掉超窗的日志行，再按 id 分批清空超窗的请求 / 响应正文。
 * 启动首跑（0ms）替代原先「启动时清理」的一次性调用，此后按天执行，
 * 不再依赖写日志时的按天节流——空闲不写库的日子也照常清理。
 */
export const logRetentionJob: SchedulerJob = {
  id: 'log:retention',
  cron: CRON,
  startupDelayMs: 0,
  run: cleanupExpiredLogs
}
