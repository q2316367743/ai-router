import { checkpointWal } from '$/db/client'
import type { SchedulerJob } from '../job'

/** 每天 04:10（本地时区）：把 WAL 内容写回主库并截断 wal 文件 */
const CRON = '0 10 4 * * *'
/** 启动首跑延时：截断要写回全部 WAL 页，大库上是同步写、可能耗时数秒，等首屏取数结束再跑 */
const STARTUP_DELAY_MS = 30_000

/**
 * WAL 维护：长驻网关持续写入，WAL 只增不减会撑到 GB 级（读事务占住了自动 checkpoint 时更明显）。
 * 每天截断一次把体积收回库文件；被未结束的读事务占住时本轮跳过，不重试也不报错。
 */
export const walCheckpointJob: SchedulerJob = {
  id: 'db:wal-checkpoint',
  cron: CRON,
  startupDelayMs: STARTUP_DELAY_MS,
  run: checkpointWal
}
