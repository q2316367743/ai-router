import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 用量聚合表：按 日期/小时 × 供应商 × 对外模型 累加，支撑统计看板（成功率、延迟、缓存构成）。
 *
 * - 两表共用同一列集合，仅时间桶键与粒度不同；token 列只累加成功请求，请求数与耗时不分成败。
 * - usage_daily 永久保留（近 7 天/近 30 天视图）；usage_hourly 滚动保留 7 天（今天/近 24 小时视图）。
 */

/** 单次请求累加到聚合表的最小入参（由 proxyLog 统一写入） */
const usageColumns = {
  /** 请求数（含失败） */
  requestCount: integer('request_count').notNull().default(0),
  /** 成功请求数（HTTP 2xx） */
  successCount: integer('success_count').notNull().default(0),
  /** 失败请求数（非 2xx，含本地拦截与客户端断开 499） */
  failCount: integer('fail_count').notNull().default(0),
  /** 响应耗时累计（ms，含失败请求，均值 = durationMs / requestCount） */
  durationMs: integer('duration_ms').notNull().default(0),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  /** 思考 token（提供商上报） */
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  /** 无法统计 token：成功请求中提供商未上报用量时的兜底估算值 */
  unrecognizedTokens: integer('unrecognized_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0)
}

export const usageDaily = sqliteTable(
  'usage_daily',
  {
    /** YYYY-MM-DD（本地时区） */
    date: text('date').notNull(),
    providerName: text('provider_name').notNull(),
    publicModel: text('public_model').notNull(),
    ...usageColumns
  },
  (t) => [primaryKey({ columns: [t.date, t.providerName, t.publicModel] })]
)

export const usageHourly = sqliteTable(
  'usage_hourly',
  {
    /** YYYY-MM-DDTHH（本地时区，字符串字典序即时间序） */
    hourKey: text('hour_key').notNull(),
    providerName: text('provider_name').notNull(),
    publicModel: text('public_model').notNull(),
    ...usageColumns
  },
  (t) => [
    primaryKey({ columns: [t.hourKey, t.providerName, t.publicModel] }),
    index('idx_usage_hourly_key').on(t.hourKey)
  ]
)
