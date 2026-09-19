import type { LogListQuery, RequestLogItem } from '@common/types'
import { isPendingStatus } from '@/utils/format'

/** 推送触发刷新的防抖窗口：并发请求下把多次写库合并为一次查询 */
const CHANGE_DEBOUNCE_MS = 300
/** 兜底轮询间隔（推送丢失 / 窗口从后台恢复时补齐） */
const POLL_INTERVAL_MS = 30_000
/** 进行中行耗时刷新间隔 */
const TICK_INTERVAL_MS = 1_000

interface LogRefreshOptions {
  /** 收集当前查询条件（含分页），调用时取最新值 */
  buildQuery: () => LogListQuery
  /** 自动刷新开关 */
  autoRefresh: Ref<boolean>
  /** 当前页码：仅第 1 页订阅推送刷新（新日志插在列表顶部） */
  page: Ref<number>
}

/**
 * 日志列表取数：推送订阅（log:changed）+ 防抖 + 兜底轮询 + 进行中耗时计时。
 *
 * 兜底轮询静默刷新（不亮 loading）且窗口隐藏时跳过，与推送路径的 hidden 判断对齐；
 * 进行中的请求在列表里需要「实时耗时」，故维护一个 now 时间戳；只在存在进行中行时启动
 * 1s 计时器，无进行中行时完全停掉，空闲态零开销。
 */
export function useLogRefresh(options: LogRefreshOptions) {
  const list = ref<RequestLogItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  /** 当前时间戳，用于计算进行中行的实时耗时 */
  const now = ref(Date.now())

  const hasPending = computed(() => list.value.some((row) => isPendingStatus(row.status)))

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: (() => void) | null = null
  /** 查询进行中标记：期间到达的刷新请求合并为一次补跑，避免并发覆盖结果 */
  let inFlight = false
  let queued = false
  /** 补跑是否静默（同一次合并里以最后一角的请求为准） */
  let queuedSilent = false

  async function refresh(opts?: { silent?: boolean }): Promise<void> {
    const silent = opts?.silent ?? false
    if (inFlight) {
      queued = true
      queuedSilent = silent
      return
    }
    inFlight = true
    if (!silent) loading.value = true
    try {
      const result = await window.preload.log.list(options.buildQuery())
      list.value = result.items
      total.value = result.total
      // 进行中行的耗时以本次取数时刻为基准，避免沿用上一次刷新的旧时间
      if (hasPending.value) now.value = Date.now()
    } finally {
      loading.value = false
      inFlight = false
      if (queued) {
        queued = false
        void refresh({ silent: queuedSilent })
      }
    }
  }

  /** 推送触发的刷新：自动刷新关闭 / 不在第 1 页 / 窗口不可见时跳过 */
  function onChanged(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!options.autoRefresh.value) return
      if (options.page.value !== 1) return
      if (document.visibilityState === 'hidden') return
      void refresh()
    }, CHANGE_DEBOUNCE_MS)
  }

  function stopTick(): void {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }

  // 进行中行出现时启动耗时计时，全部结束后停掉
  watch(hasPending, (pending) => {
    stopTick()
    if (pending) tickTimer = setInterval(() => (now.value = Date.now()), TICK_INTERVAL_MS)
  })

  onMounted(() => {
    void refresh()
    unsubscribe = window.preload.log.onChanged(onChanged)
    pollTimer = setInterval(() => {
      // 窗口隐藏到托盘时跳过轮询（推送恢复可见后仍会触发），轮询走静默不闪 loading
      if (options.autoRefresh.value && document.visibilityState !== 'hidden') {
        void refresh({ silent: true })
      }
    }, POLL_INTERVAL_MS)
  })

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer)
    if (debounceTimer) clearTimeout(debounceTimer)
    stopTick()
    unsubscribe?.()
  })

  return { list, total, loading, now, refresh }
}
