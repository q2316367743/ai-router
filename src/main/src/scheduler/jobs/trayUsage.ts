import { refreshTrayUsage } from '$/app/tray'
import type { SchedulerJob } from '../job'

/** 兜底刷新周期：覆盖跨天归零与写库钩子遗漏的场景 */
const CRON = '*/30 * * * * *'

/**
 * 托盘今日用量：每 30 秒兜底刷一次（写库钩子会即时刷，这里只保证「没人写库时也不会停在旧值」）。
 * 不设启动首跑：托盘注册时已刷过一次。
 */
export const trayUsageJob: SchedulerJob = {
  id: 'tray:usage',
  cron: CRON,
  run: refreshTrayUsage
}
