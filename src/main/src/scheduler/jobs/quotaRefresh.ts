import { refreshProviderQuota } from '$/quota/service'
import type { SchedulerJob } from '../job'

/** 刷新周期：限额窗口（5 小时/周/月）变化不快，10 分钟足够跟手 */
const CRON = '0 */10 * * * *'
/** 启动首刷延时：避开启动瞬间的代理服务与窗口创建 */
const STARTUP_DELAY_MS = 5_000

/** 余量刷新：逐个查询绑定了策略的启用提供商，单家失败不影响其余（快照保留旧值） */
export const quotaRefreshJob: SchedulerJob = {
  id: 'quota:refresh',
  cron: CRON,
  startupDelayMs: STARTUP_DELAY_MS,
  run: () => refreshProviderQuota()
}
