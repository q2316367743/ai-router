/**
 * 定时任务契约与装配：任务只声明「节奏 + 做什么」，什么时候跑由 croner 负责。
 *
 * - protect：上一轮还在跑就跳过本轮触发（余量刷新最长 20s，正文清扫在大库上可能断续跑几分钟）；
 * - unref：定时器不阻止进程退出，退出时统一由 stopAllJobs 停表；
 * - 任务内抛错在这里收口成一行日志，不打断调度器与其他任务，故不再用 croner 的 catch 选项。
 */
import { Cron } from 'croner'

/** 一个定时任务的完整定义 */
export interface SchedulerJob {
  /** 任务名（唯一）：日志前缀 + 重复注册检测，形如 `域:动作` */
  id: string
  /** 触发节奏：6 段 cron（秒 分 时 日 月 周），秒段可用 `*` 表达秒级周期 */
  cron: string
  /**
   * 启动首跑延时（ms）：0 = 启动即跑；不填 = 启动时不跑，只按 cron 周期走。
   * 用于「启动就该补一次」的任务，以及多个任务同刻首跑时的错峰。
   */
  startupDelayMs?: number
  run: () => void | Promise<void>
}

/** 已注册任务的运行时句柄 */
interface RegisteredJob {
  cron: Cron
  startupTimer: ReturnType<typeof setTimeout> | null
}

const registered = new Map<string, RegisteredJob>()

/** 注册一个任务；cron 表达式非法等装配错误就地抛出，由调用方决定是否继续注册其余任务 */
export function registerJob(job: SchedulerJob): void {
  if (registered.has(job.id)) {
    console.warn(`[scheduler] 任务 ${job.id} 已注册，跳过重复注册`)
    return
  }
  const cron = new Cron(job.cron, { name: job.id, protect: true, unref: true }, () => runJob(job))
  const entry: RegisteredJob = { cron, startupTimer: null }
  if (job.startupDelayMs !== undefined) {
    entry.startupTimer = setTimeout(() => {
      entry.startupTimer = null
      void runJob(job)
    }, job.startupDelayMs)
  }
  registered.set(job.id, entry)
}

/** 停止全部任务：清掉未触发的首跑延时器并让 cron 停表（已在跑的一轮不打断，随进程退出结束） */
export function stopAllJobs(): void {
  for (const entry of registered.values()) {
    if (entry.startupTimer) clearTimeout(entry.startupTimer)
    entry.cron.stop()
  }
  registered.clear()
}

/** 执行一轮任务：与周期触发共用同一错误口径（protect 只约束 cron 触发，故首跑也走这里） */
async function runJob(job: SchedulerJob): Promise<void> {
  try {
    await job.run()
  } catch (err) {
    console.error(`[scheduler] 任务 ${job.id} 执行失败：`, err instanceof Error ? err.message : err)
  }
}
