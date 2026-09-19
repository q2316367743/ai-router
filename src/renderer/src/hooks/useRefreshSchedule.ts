/**
 * 节拍刷新：进页面按「上次刷新完成时刻」排一次延时刷新，刷新完成后按固定间隔重排。
 *
 * 为什么不用 setInterval：
 * - 时间戳存在模块级 Map（按 key 区分），页面卸载 / 重进不重置节拍 —— 切走再切回来时，
 *   未到点不白刷，已过期立刻补一次（30s 节拍下第 25 秒回到页面 → 5 秒后刷新）；
 * - 「上次刷新完成时刻」在刷新结束后才记，节拍永远锚在真正取到数据的时刻上；
 * - 窗口不可见（隐藏 / 最小化）时跳过本轮，回到可见时按同一规则补一次 ——
 *   主进程的查询是同步的，后台空刷会持续占用它。
 *
 * 用法：在 keep-alive 页面内调用（节拍随 onActivated / onDeactivated 起停）；
 * 不在 keep-alive 内也能工作，此时退化为随 onMounted / onUnmounted 起停。
 */
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

/** 默认节拍间隔（30 秒） */
const DEFAULT_INTERVAL_MS = 30_000

/** key → 上次刷新完成时刻（跨页面卸载保留；缺省表示本次运行内从未刷新过） */
const lastRefreshAt = new Map<string, number>()

export interface RefreshScheduleOptions {
  /** 节拍标识：同一渲染进程内唯一即可（用页面名最省事） */
  key: string
  /** 节拍间隔（ms） */
  intervalMs?: number
}

export function useRefreshSchedule(
  refresh: () => void | Promise<void>,
  options: RefreshScheduleOptions
): void {
  const { key } = options
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  /** 页面是否处于激活态：失活后到期的刷新不再排期（切走即停表） */
  let active = false
  /** 取数进行中：期间再次到点只记一次补跑，避免并发覆盖结果 */
  let inFlight = false
  let queued = false

  /** 距下次刷新的剩余时长；已过期或从未刷新为 0 */
  function remainingMs(): number {
    const last = lastRefreshAt.get(key) ?? 0
    return Math.max(0, intervalMs - (Date.now() - last))
  }

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(delayMs: number): void {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      onTick()
    }, Math.max(0, delayMs))
  }

  /** 到点：窗口不可见时跳过本轮（回到可见时由 visibilitychange 补） */
  function onTick(): void {
    if (!active || document.visibilityState === 'hidden') return
    void run()
  }

  function onVisibilityChange(): void {
    if (!active || document.visibilityState !== 'visible') return
    if (!timer && !inFlight && remainingMs() === 0) void run()
  }

  async function run(): Promise<void> {
    if (inFlight) {
      queued = true
      return
    }
    inFlight = true
    try {
      await refresh()
      lastRefreshAt.set(key, Date.now())
    } finally {
      inFlight = false
      if (queued) {
        // 补跑只在页面仍激活时执行；失活后由下次 start() 按陈旧度重新决定
        queued = false
        if (active) void run()
      } else if (active) {
        schedule(intervalMs)
      }
    }
  }

  /** 进入页面：已过期（含首次进入）立刻补一次，未过期只等剩余时长 */
  function start(): void {
    active = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    // onMounted 与 onActivated 会先后触发，这里以「已排期 / 取数中」去重
    if (timer || inFlight) return
    const remaining = remainingMs()
    if (remaining === 0) void run()
    else schedule(remaining)
  }

  function stop(): void {
    active = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    clearTimer()
  }

  onMounted(start)
  onUnmounted(stop)
  onActivated(start)
  onDeactivated(stop)
}
