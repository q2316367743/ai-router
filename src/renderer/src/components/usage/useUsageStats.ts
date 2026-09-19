/**
 * 看板数据与派生指标：主窗口首页与托盘面板共用的取数逻辑。
 *
 * - 统计口径全部在 main 侧（usageRepo），本文件只做展示派生（百分比、token 构成分段）。
 * - 维度切换会重新拉取；筛选变化同样重新拉取（main 侧已按筛选条件过滤）。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { UsageFilterOptions, UsageOverview, UsageQuery, UsageRangeKey } from '@common/types'

/** 令牌构成的一段（用于进度条 + 环形图） */
export interface CompositionSegment {
  name: string
  value: number
  /** 占四维总量的百分比 */
  percent: number
  /** 相对最大值的条宽百分比（最大值 100%） */
  barPercent: number
  /** 语义 key，业务侧据此取色（不在此处写裸色值） */
  tone: 'input' | 'output' | 'cache' | 'unknown'
}

/** 指标好坏档位（有明确优劣的指标用） */
export type StatSeverity = 'good' | 'fair' | 'poor'

/** 指标量级档位（无优劣、只比多少的指标用），1 最小 → 4 最大 */
export type StatMagnitude = 1 | 2 | 3 | 4

/** 请求数量级阈值：<100 / <1k / <10k / ≥10k */
export const REQUEST_MAGNITUDE_THRESHOLDS: [number, number, number] = [100, 1_000, 10_000]

/** Tokens 数量级阈值：<10k / <100k / <1M / ≥1M */
export const TOKEN_MAGNITUDE_THRESHOLDS: [number, number, number] = [10_000, 100_000, 1_000_000]

/**
 * 成功率档位（%）：≥99 好 / ≥95 中 / 其余差。
 * 无请求时返回 null —— 没有数据就不做好坏判断，展示层据此回落中性色。
 */
export function successSeverity(rate: number | null): StatSeverity | null {
  if (rate === null) return null
  if (rate >= 99) return 'good'
  if (rate >= 95) return 'fair'
  return 'poor'
}

/**
 * 平均延迟档位（ms）：<2s 好 / <5s 中 / ≥5s 差。
 * 阈值比纯网络延迟宽松，因为这里统计的是端到端耗时（含上游预填充与生成时间）。
 */
export function latencySeverity(ms: number | null): StatSeverity | null {
  if (ms === null) return null
  if (ms < 5_000) return 'good'
  if (ms < 10_000) return 'fair'
  return 'poor'
}

/**
 * 量级档位：按数量级切 4 档，而非固定绝对值。
 * 同一份「1000 次请求」在「今天」与「近 30 天」维度下意义完全不同，
 * 固定阈值会让某个维度恒为最高档，按数量级分档才对「数字大小程度」有可读的区分度。
 */
export function magnitudeLevel(value: number, thresholds: [number, number, number]): StatMagnitude {
  if (value < thresholds[0]) return 1
  if (value < thresholds[1]) return 2
  if (value < thresholds[2]) return 3
  return 4
}

function emptyOverview(range: UsageRangeKey): UsageOverview {
  return {
    range,
    granularity: range === 'today' || range === 'last24h' ? 'hour' : 'day',
    totals: {
      requestCount: 0,
      successCount: 0,
      failCount: 0,
      durationMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      unrecognizedTokens: 0,
      totalTokens: 0
    },
    providers: [],
    models: [],
    series: {
      granularity: range === 'today' || range === 'last24h' ? 'hour' : 'day',
      buckets: [],
      labels: [],
      requestCount: [],
      totalTokens: [],
      cacheTokens: [],
      byProviderTokens: []
    },
    activity: {
      startDate: '',
      days: 0,
      cells: [],
      longestStreak: 0,
      dailyAverageTokens: 0,
      weeklyAverageTokens: 0,
      totalTokens: 0
    }
  }
}

export interface UseUsageStatsResult {
  range: Ref<UsageRangeKey>
  /** 空串表示不筛选（t-select 的 v-model 不接受 null） */
  providerName: Ref<string>
  publicModel: Ref<string>
  loading: Ref<boolean>
  overview: Ref<UsageOverview>
  filterOptions: Ref<UsageFilterOptions>
  /** 成功率（%），无请求时为 null 表示不展示 */
  successRate: ComputedRef<number | null>
  /** 平均延迟（ms），无请求时为 null */
  averageDurationMs: ComputedRef<number | null>
  /** 缓存占总量比（%）：缓存 token / 总 token */
  cacheRatio: ComputedRef<number>
  /** 缓存 token 合计（读 + 写） */
  cacheTokens: ComputedRef<number>
  /** 令牌构成四段（无数据的分段不返回） */
  composition: ComputedRef<CompositionSegment[]>
  /** 取一次数据（含筛选项）；`silent` 供节拍刷新使用：不显示加载态，避免停留期间反复闪遮罩 */
  refresh(options?: { silent?: boolean }): Promise<void>
}

export function useUsageStats(initialRange: UsageRangeKey = 'last24h'): UseUsageStatsResult {
  const range = useLocalStorage<UsageRangeKey>('range', initialRange)
  const providerName = ref('')
  const publicModel = ref('')
  const loading = ref(false)
  const overview = ref<UsageOverview>(emptyOverview(initialRange))
  const filterOptions = ref<UsageFilterOptions>({ providers: [], models: [] })

  const successRate = computed<number | null>(() => {
    const { requestCount, successCount } = overview.value.totals
    return requestCount > 0 ? (successCount / requestCount) * 100 : null
  })

  const averageDurationMs = computed<number | null>(() => {
    const { requestCount, durationMs } = overview.value.totals
    return requestCount > 0 ? durationMs / requestCount : null
  })

  const cacheTokens = computed(
    () => overview.value.totals.cacheReadTokens + overview.value.totals.cacheWriteTokens
  )

  const cacheRatio = computed(() => {
    const total = overview.value.totals.totalTokens
    return total > 0 ? (cacheTokens.value / total) * 100 : 0
  })

  const composition = computed<CompositionSegment[]>(() => {
    const t = overview.value.totals
    const raw: Array<{ name: string; value: number; tone: CompositionSegment['tone'] }> = [
      { name: '输入', value: t.promptTokens, tone: 'input' },
      { name: '输出', value: t.completionTokens, tone: 'output' },
      { name: '缓存', value: cacheTokens.value, tone: 'cache' },
      { name: '无法统计', value: t.unrecognizedTokens, tone: 'unknown' }
    ]
    // 为 0 的分段不展示（你要求的「没有就不显示」）
    const shown = raw.filter((item) => item.value > 0)
    const sum = shown.reduce((acc, item) => acc + item.value, 0)
    const max = shown.reduce((acc, item) => Math.max(acc, item.value), 0)
    if (sum === 0) return []
    return shown.map((item) => ({
      ...item,
      percent: (item.value / sum) * 100,
      barPercent: (item.value / max) * 100
    }))
  })

  async function refresh(silent = false): Promise<void> {
    if (!silent) loading.value = true
    try {
      const query: UsageQuery = {
        range: range.value,
        providerName: providerName.value || null,
        publicModel: publicModel.value || null
      }
      overview.value = await window.preload.usage.overview(query)
    } finally {
      if (!silent) loading.value = false
    }
  }

  async function loadFilters(): Promise<void> {
    filterOptions.value = await window.preload.usage.filterOptions()
  }

  // 维度与筛选变化均触发重新取数（口径与筛选统一在 main 处理）
  watch([range, providerName, publicModel], () => {
    void refresh()
  })

  return {
    range,
    providerName,
    publicModel,
    loading,
    overview,
    filterOptions,
    successRate,
    averageDurationMs,
    cacheRatio,
    cacheTokens,
    composition,
    refresh: async (options?: { silent?: boolean }) => {
      await Promise.all([refresh(options?.silent ?? false), loadFilters()])
    }
  }
}
