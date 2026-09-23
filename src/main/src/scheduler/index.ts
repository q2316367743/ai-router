/**
 * 定时任务总入口：登记全部周期任务，统一启停。
 *
 * 长驻网关不能依赖「启动时清理」——进程活着的每一天都要按时清理与刷新，所以周期动作统一在这里
 * 登记；业务侧只导出「做什么」的函数，不再自己 setInterval。
 */
import { markPendingInterrupted } from '$/db/repo/logRepo'
import { registerJob, stopAllJobs } from './job'
import type { SchedulerJob } from './job'
import { logRetentionJob } from './jobs/logRetention'
import { quotaRefreshJob } from './jobs/quotaRefresh'
import { trayUsageJob } from './jobs/trayUsage'
import { usageRetentionJob } from './jobs/usageRetention'
import { walCheckpointJob } from './jobs/walCheckpoint'

/** 全部定时任务：数组顺序即同刻首跑的执行顺序 */
const JOBS: SchedulerJob[] = [
  logRetentionJob,
  trayUsageJob,
  usageRetentionJob,
  quotaRefreshJob,
  walCheckpointJob
]

let started = false

/** 启动全部定时任务（须在 initDb 之后调用）；重复调用无副作用 */
export function startSchedulers(): void {
  if (started) return
  started = true

  // 启动收口：上次退出 / 崩溃遗留的进行中日志标记为 499 服务中断。只能发生在启动，故不建成周期任务
  markPendingInterrupted()

  const failed: string[] = []
  for (const job of JOBS) {
    try {
      registerJob(job)
    } catch (err) {
      failed.push(job.id)
      console.error(
        `[scheduler] 任务 ${job.id} 注册失败：`,
        err instanceof Error ? err.message : err
      )
    }
  }
  const startedIds = JOBS.filter((job) => !failed.includes(job.id))
  console.log(
    `[scheduler] 已启动 ${startedIds.length} 个任务：${startedIds
      .map((job) => `${job.id}（${job.cron}）`)
      .join('、')}`
  )
  if (failed.length > 0) console.error(`[scheduler] 未启动：${failed.join('、')}`)
}

/** 停止全部定时任务（应用退出时调用） */
export function stopSchedulers(): void {
  if (!started) return
  started = false
  stopAllJobs()
  console.log('[scheduler] 定时任务已停止')
}
