import dayjs from 'dayjs'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type {
  UsageActivity,
  UsageActivityCell,
  UsageDailyItem,
  UsageFilterOptions,
  UsageGranularity,
  UsageGroupItem,
  UsageOverview,
  UsageQuery,
  UsageRangeKey,
  UsageSeries,
  UsageSeriesLine,
  UsageTotals
} from '@common/types'
import { db } from '../client'
import { usageDaily, usageHourly } from '../schema'
import { dayLabel, hourLabel, todayKey } from '$/utils/date'

/**
 * 用量聚合仓储：写入按「时间桶 × 供应商 × 模型」累加，读取按统计维度聚合为看板数据。
 *
 * - 两张聚合表列集合完全一致，仅时间桶键与粒度不同：usage_daily（天，永久）/ usage_hourly（小时，7 天）。
 * - 统计口径集中在本文件：token 只累加成功请求；请求数与耗时不分成败；成功率 = successCount / requestCount。
 */

/** usage_hourly 滚动保留窗口（天，含当天）：覆盖「今天」与「近 24 小时」两个维度 */
const HOURLY_RETENTION_DAYS = 7
/** 活跃度热力图短窗口（天）：维度不足 30 天时使用，避免退化为单格 */
const ACTIVITY_DAYS_SHORT = 7
/** 活跃度热力图长窗口（天）：近 30 天维度使用 */
const ACTIVITY_DAYS_LONG = 30

type UsageTable = typeof usageDaily | typeof usageHourly

/** 单次请求累加聚合表的入参（token 字段由调用方保证仅在成功请求时有值） */
export interface UsageAccumulateInput {
  providerName: string
  publicModel: string
  /** HTTP 状态码（2xx 视为成功） */
  status: number
  /** 响应耗时（ms） */
  durationMs: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  /** 提供商未上报用量时的兜底估算值 */
  unrecognizedTokens: number
}

/** 时间桶解析结果：桶键按时间升序，缺失桶由读取侧补零 */
interface ResolvedRange {
  granularity: UsageGranularity
  buckets: string[]
  startKey: string
  endKey: string
}

/** 聚合表原始行（时间桶由查询侧按粒度选列） */
interface UsageRow extends UsageTotals {
  bucket: string
  providerName: string
  publicModel: string
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

function emptyTotals(): UsageTotals {
  return {
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
  }
}

function addTotals(target: UsageTotals, source: UsageTotals): void {
  target.requestCount += source.requestCount
  target.successCount += source.successCount
  target.failCount += source.failCount
  target.durationMs += source.durationMs
  target.promptTokens += source.promptTokens
  target.completionTokens += source.completionTokens
  target.reasoningTokens += source.reasoningTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
  target.unrecognizedTokens += source.unrecognizedTokens
  target.totalTokens += source.totalTokens
}

/** 把统计维度解析为时间桶序列（时间口径统一在 main，渲染层只传维度枚举） */
export function resolveRange(range: UsageRangeKey): ResolvedRange {
  const now = dayjs()
  if (range === 'today' || range === 'last24h') {
    const endHour = now.startOf('hour')
    const startHour = range === 'today' ? now.startOf('day') : endHour.subtract(23, 'hour')
    const buckets: string[] = []
    for (let t = startHour; !t.isAfter(endHour); t = t.add(1, 'hour')) {
      buckets.push(t.format('YYYY-MM-DDTHH'))
    }
    return {
      granularity: 'hour',
      buckets,
      startKey: startHour.format('YYYY-MM-DDTHH'),
      endKey: endHour.format('YYYY-MM-DDTHH')
    }
  }
  const days = range === 'last7d' ? ACTIVITY_DAYS_SHORT : ACTIVITY_DAYS_LONG
  const endDay = now.startOf('day')
  const startDay = endDay.subtract(days - 1, 'day')
  const buckets: string[] = []
  for (let i = 0; i < days; i += 1) {
    buckets.push(startDay.add(i, 'day').format('YYYY-MM-DD'))
  }
  return {
    granularity: 'day',
    buckets,
    startKey: startDay.format('YYYY-MM-DD'),
    endKey: endDay.format('YYYY-MM-DD')
  }
}

/** 活跃度热力图窗口天数：近 30 天维度取 30 天，其余维度回落 7 天 */
export function activityDaysOf(range: UsageRangeKey): number {
  return range === 'last30d' ? ACTIVITY_DAYS_LONG : ACTIVITY_DAYS_SHORT
}

/**
 * 累加一次请求到日 / 小时两张聚合表，并顺带清理超窗小时桶。
 * 请求数与耗时不分成败；token 六维与无法统计仅在成功请求时累加（失败请求的用量不可信）。
 */
export function accumulateUsage(input: UsageAccumulateInput): void {
  const ok = isSuccessStatus(input.status)
  const values = {
    providerName: input.providerName,
    publicModel: input.publicModel,
    requestCount: 1,
    successCount: ok ? 1 : 0,
    failCount: ok ? 0 : 1,
    durationMs: input.durationMs,
    promptTokens: ok ? input.promptTokens : 0,
    completionTokens: ok ? input.completionTokens : 0,
    reasoningTokens: ok ? input.reasoningTokens : 0,
    cacheReadTokens: ok ? input.cacheReadTokens : 0,
    cacheWriteTokens: ok ? input.cacheWriteTokens : 0,
    unrecognizedTokens: ok ? input.unrecognizedTokens : 0,
    totalTokens: ok ? input.totalTokens : 0
  }

  db().transaction((tx) => {
    tx.insert(usageDaily)
      .values({ date: todayKey(), ...values })
      .onConflictDoUpdate({
        target: [usageDaily.date, usageDaily.providerName, usageDaily.publicModel],
        set: conflictSet(usageDaily)
      })
      .run()

    tx.insert(usageHourly)
      .values({ hourKey: dayjs().format('YYYY-MM-DDTHH'), ...values })
      .onConflictDoUpdate({
        target: [usageHourly.hourKey, usageHourly.providerName, usageHourly.publicModel],
        set: conflictSet(usageHourly)
      })
      .run()
  })

  cleanupExpiredHourly()
}

/** 冲突累加：两表列集合一致，仅表引用不同 */
function conflictSet(table: UsageTable) {
  return {
    requestCount: sql`${table.requestCount} + excluded.request_count`,
    successCount: sql`${table.successCount} + excluded.success_count`,
    failCount: sql`${table.failCount} + excluded.fail_count`,
    durationMs: sql`${table.durationMs} + excluded.duration_ms`,
    promptTokens: sql`${table.promptTokens} + excluded.prompt_tokens`,
    completionTokens: sql`${table.completionTokens} + excluded.completion_tokens`,
    reasoningTokens: sql`${table.reasoningTokens} + excluded.reasoning_tokens`,
    cacheReadTokens: sql`${table.cacheReadTokens} + excluded.cache_read_tokens`,
    cacheWriteTokens: sql`${table.cacheWriteTokens} + excluded.cache_write_tokens`,
    unrecognizedTokens: sql`${table.unrecognizedTokens} + excluded.unrecognized_tokens`,
    totalTokens: sql`${table.totalTokens} + excluded.total_tokens`
  }
}

/** 清理超出保留窗口的小时桶 */
function cleanupExpiredHourly(): void {
  const boundary = dayjs().subtract(HOURLY_RETENTION_DAYS, 'day').format('YYYY-MM-DDTHH')
  db().delete(usageHourly).where(lte(usageHourly.hourKey, boundary)).run()
}

/** 数值列投影（两表列名一致，按表实例取列引用） */
function totalsColumns(table: UsageTable) {
  return {
    requestCount: table.requestCount,
    successCount: table.successCount,
    failCount: table.failCount,
    durationMs: table.durationMs,
    promptTokens: table.promptTokens,
    completionTokens: table.completionTokens,
    reasoningTokens: table.reasoningTokens,
    cacheReadTokens: table.cacheReadTokens,
    cacheWriteTokens: table.cacheWriteTokens,
    unrecognizedTokens: table.unrecognizedTokens,
    totalTokens: table.totalTokens
  }
}

/** 按解析出的粒度选择聚合表并应用筛选条件 */
function selectRows(range: ResolvedRange, query: UsageQuery): UsageRow[] {
  if (range.granularity === 'hour') {
    return db()
      .select({
        bucket: usageHourly.hourKey,
        providerName: usageHourly.providerName,
        publicModel: usageHourly.publicModel,
        ...totalsColumns(usageHourly)
      })
      .from(usageHourly)
      .where(
        and(
          gte(usageHourly.hourKey, range.startKey),
          lte(usageHourly.hourKey, range.endKey),
          query.providerName ? eq(usageHourly.providerName, query.providerName) : undefined,
          query.publicModel ? eq(usageHourly.publicModel, query.publicModel) : undefined
        )
      )
      .all()
  }
  return db()
    .select({
      bucket: usageDaily.date,
      providerName: usageDaily.providerName,
      publicModel: usageDaily.publicModel,
      ...totalsColumns(usageDaily)
    })
    .from(usageDaily)
    .where(
      and(
        gte(usageDaily.date, range.startKey),
        lte(usageDaily.date, range.endKey),
        query.providerName ? eq(usageDaily.providerName, query.providerName) : undefined,
        query.publicModel ? eq(usageDaily.publicModel, query.publicModel) : undefined
      )
    )
    .all()
}

/** 按维度（供应商 / 模型）分组累加，输出按 token 降序 */
function groupBy(rows: UsageRow[], pick: (row: UsageRow) => string): UsageGroupItem[] {
  const map = new Map<string, UsageGroupItem>()
  for (const row of rows) {
    const key = pick(row)
    let item = map.get(key)
    if (!item) {
      item = { key, ...emptyTotals() }
      map.set(key, item)
    }
    addTotals(item, row)
  }
  return [...map.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key)
  )
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

/** 构建时间序列：请求数 / 总 token / 缓存 token + 按供应商分线的总 token（缺失桶补零） */
function buildSeries(range: ResolvedRange, rows: UsageRow[]): UsageSeries {
  const bucketIndex = new Map(range.buckets.map((key, i) => [key, i]))
  const size = range.buckets.length
  const requestCount = new Array<number>(size).fill(0)
  const totalTokens = new Array<number>(size).fill(0)
  const cacheTokens = new Array<number>(size).fill(0)
  const providerSeries = new Map<string, number[]>()

  for (const row of rows) {
    const i = bucketIndex.get(row.bucket)
    if (i === undefined) continue
    requestCount[i] += row.requestCount
    totalTokens[i] += row.totalTokens
    cacheTokens[i] += row.cacheReadTokens + row.cacheWriteTokens

    let line = providerSeries.get(row.providerName)
    if (!line) {
      line = new Array<number>(size).fill(0)
      providerSeries.set(row.providerName, line)
    }
    line[i] += row.totalTokens
  }

  const byProviderTokens: UsageSeriesLine[] = [...providerSeries.entries()]
    .map(([name, data]) => ({ name, data }))
    .sort((a, b) => sum(b.data) - sum(a.data) || a.name.localeCompare(b.name))

  const toLabel = range.granularity === 'hour' ? hourLabel : dayLabel
  return {
    granularity: range.granularity,
    buckets: range.buckets,
    labels: range.buckets.map(toLabel),
    requestCount,
    totalTokens,
    cacheTokens,
    byProviderTokens
  }
}

/** 活跃度热力图：固定按日粒度从 usage_daily 取数（与所选维度的图表粒度无关） */
function buildActivity(range: UsageRangeKey): UsageActivity {
  const days = activityDaysOf(range)
  const endDay = dayjs().startOf('day')
  const startDay = endDay.subtract(days - 1, 'day')
  const startDate = startDay.format('YYYY-MM-DD')
  const endDate = endDay.format('YYYY-MM-DD')

  const rows = db()
    .select({
      date: usageDaily.date,
      requestCount: usageDaily.requestCount,
      totalTokens: usageDaily.totalTokens
    })
    .from(usageDaily)
    .where(and(gte(usageDaily.date, startDate), lte(usageDaily.date, endDate)))
    .all()

  const byDate = new Map<string, UsageActivityCell>()
  for (const row of rows) {
    let cell = byDate.get(row.date)
    if (!cell) {
      cell = { date: row.date, requestCount: 0, totalTokens: 0 }
      byDate.set(row.date, cell)
    }
    cell.requestCount += row.requestCount
    cell.totalTokens += row.totalTokens
  }

  const cells: UsageActivityCell[] = []
  let longestStreak = 0
  let currentStreak = 0
  for (let i = 0; i < days; i += 1) {
    const date = startDay.add(i, 'day').format('YYYY-MM-DD')
    const cell = byDate.get(date) ?? { date, requestCount: 0, totalTokens: 0 }
    cells.push(cell)
    if (cell.requestCount > 0) {
      currentStreak += 1
      longestStreak = Math.max(longestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  const totalTokens = sum(cells.map((cell) => cell.totalTokens))
  const dailyAverageTokens = totalTokens / days
  return {
    startDate,
    days,
    cells,
    longestStreak,
    dailyAverageTokens,
    weeklyAverageTokens: dailyAverageTokens * 7,
    totalTokens
  }
}

/** 看板全量数据：一次查询同时产出总计、供应商 / 模型拆分、时间序列与活跃度 */
export function queryUsageOverview(query: UsageQuery): UsageOverview {
  const range = resolveRange(query.range)
  const rows = selectRows(range, query)
  const totals = emptyTotals()
  for (const row of rows) addTotals(totals, row)

  return {
    range: query.range,
    granularity: range.granularity,
    totals,
    providers: groupBy(rows, (row) => row.providerName),
    models: groupBy(rows, (row) => row.publicModel),
    series: buildSeries(range, rows),
    activity: buildActivity(query.range)
  }
}

/** 统计筛选项：聚合表去重后的供应商与模型（永久保留，供应商被删除后仍可筛选历史） */
export function queryUsageFilterOptions(): UsageFilterOptions {
  const providers = db()
    .selectDistinct({ value: usageDaily.providerName })
    .from(usageDaily)
    .all()
    .map((row) => row.value)
    .sort()
  const models = db()
    .selectDistinct({ value: usageDaily.publicModel })
    .from(usageDaily)
    .all()
    .map((row) => row.value)
    .sort()
  return { providers, models }
}

/** 查询日期区间（含边界）内按日 × 供应商 × 模型的用量明细（明细表用） */
export function listUsageByRange(startDate: string, endDate: string): UsageDailyItem[] {
  return db()
    .select({
      date: usageDaily.date,
      providerName: usageDaily.providerName,
      publicModel: usageDaily.publicModel,
      ...totalsColumns(usageDaily)
    })
    .from(usageDaily)
    .where(and(gte(usageDaily.date, startDate), lte(usageDaily.date, endDate)))
    .orderBy(asc(usageDaily.date), asc(usageDaily.providerName), asc(usageDaily.publicModel))
    .all()
}
