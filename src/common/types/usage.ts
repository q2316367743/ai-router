/** 统计维度：今天 / 近 24 小时 / 近七天 / 近 30 天 */
export type UsageRangeKey = 'today' | 'last24h' | 'last7d' | 'last30d'

/** 聚合时间粒度：小时（今天、近 24 小时）/ 天（近七天、近 30 天） */
export type UsageGranularity = 'hour' | 'day'

/** 用量查询条件（providerName / publicModel 为 null 表示不筛选） */
export interface UsageQuery {
  range: UsageRangeKey
  providerName: string | null
  publicModel: string | null
}

/** 聚合计数字段（与 usage_daily / usage_hourly 的数值列一一对应） */
export interface UsageTotals {
  /** 请求数（含失败） */
  requestCount: number
  /** 成功请求数（HTTP 2xx） */
  successCount: number
  /** 失败请求数（非 2xx，含本地拦截与客户端断开 499） */
  failCount: number
  /** 响应耗时累计（ms）；均值 = durationMs / requestCount */
  durationMs: number
  promptTokens: number
  completionTokens: number
  /** 思考 token（提供商上报） */
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 无法统计 token：成功请求中提供商未上报用量时的兜底估算值 */
  unrecognizedTokens: number
  totalTokens: number
}

/** 按维度（供应商 / 模型）拆分的用量 */
export interface UsageGroupItem extends UsageTotals {
  /** 供应商名或对外模型名 */
  key: string
}

/** 按供应商分线的 token 序列 */
export interface UsageSeriesLine {
  name: string
  data: number[]
}

/** 时间序列（缺失桶已补零；桶键/标签数组与各数据数组等长） */
export interface UsageSeries {
  granularity: UsageGranularity
  /** 桶键：hour 为 YYYY-MM-DDTHH，day 为 YYYY-MM-DD */
  buckets: string[]
  /** 展示标签：hour 为 HH:00，day 为 MM-DD */
  labels: string[]
  /** 每桶请求数（柱状） */
  requestCount: number[]
  /** 每桶总 token（折线） */
  totalTokens: number[]
  /** 每桶缓存 token（折线） */
  cacheTokens: number[]
  /** 每桶按供应商拆分的总 token */
  byProviderTokens: UsageSeriesLine[]
}

/** 模型速度折线（data 与桶等长；当日无有效请求为 null，折线断开而非画到 0） */
export interface UsageSpeedLine {
  /** 展示名：`供应商 · 模型` */
  name: string
  /** 每日输出速度（token/s） */
  data: (number | null)[]
}

/** 模型速度图数据：固定近七天窗口，数据源为 request_logs（非聚合表，见 docs/app/04-统计看板.md） */
export interface UsageModelSpeed {
  /** 桶键 YYYY-MM-DD，长度 7 */
  buckets: string[]
  /** 展示标签 MM-DD */
  labels: string[]
  /** 按窗口内总输出 token 降序，最多 5 条 */
  lines: UsageSpeedLine[]
}

/** 来源客户端统计项 */
export interface UsageClientItem {
  /** 来源客户端标识：user-agent 首个 token 的名称部分；未携带 UA 的请求归为「未知」 */
  name: string
  /** 窗口内请求数（含失败请求，与「请求数」总计同口径） */
  requestCount: number
}

/** 来源客户端柱状图数据：固定近七天窗口，数据源为 request_logs（非聚合表，见 docs/app/04-统计看板.md） */
export interface UsageClientStats {
  /** 窗口起始日（含），YYYY-MM-DD */
  startDate: string
  /** 窗口结束日（含），YYYY-MM-DD */
  endDate: string
  /** 按请求数降序 */
  items: UsageClientItem[]
}

/** 活跃度单日格子 */
export interface UsageActivityCell {
  /** YYYY-MM-DD */
  date: string
  requestCount: number
  totalTokens: number
}

/** 活跃度热力图（按日，窗口独立于所选维度） */
export interface UsageActivity {
  /** 窗口起始日（含），YYYY-MM-DD */
  startDate: string
  /** 窗口天数 */
  days: number
  cells: UsageActivityCell[]
  /** 窗口内最长连续有请求天数 */
  longestStreak: number
  /** 日均 token（窗口内总 token / 窗口天数） */
  dailyAverageTokens: number
  /** 周均 token（日均 × 7） */
  weeklyAverageTokens: number
  /** 窗口内总 token */
  totalTokens: number
}

/** 看板所需的全部统计数据（一次 IPC 返回，避免多次往返） */
export interface UsageOverview {
  range: UsageRangeKey
  granularity: UsageGranularity
  totals: UsageTotals
  /** 按供应商拆分（totalTokens 降序） */
  providers: UsageGroupItem[]
  /** 按对外模型拆分（totalTokens 降序） */
  models: UsageGroupItem[]
  series: UsageSeries
  activity: UsageActivity
}

/** 统计筛选项（来自聚合表，历史永久保留，供应商删除后仍可筛选） */
export interface UsageFilterOptions {
  providers: string[]
  models: string[]
}

/** 单日 × 供应商 × 模型 用量明细（永久保留，供明细表展示） */
export interface UsageDailyItem {
  /** YYYY-MM-DD */
  date: string
  providerName: string
  publicModel: string
  requestCount: number
  successCount: number
  failCount: number
  durationMs: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  unrecognizedTokens: number
  totalTokens: number
}
