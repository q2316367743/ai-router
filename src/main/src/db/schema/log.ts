import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 请求详细日志：仅保留当天，跨天由 logRepo 惰性清理（DELETE log_date < 今天） */
export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 日志归属日期（YYYY-MM-DD），清理依据 */
    logDate: text('log_date').notNull(),
    createdAt: integer('created_at').notNull(),
    publicModel: text('public_model').notNull(),
    providerName: text('provider_name').notNull(),
    upstreamModel: text('upstream_model').notNull(),
    path: text('path').notNull(),
    /** 上游响应状态码；本地拦截时为 401/404/502 等 */
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    stream: integer('stream', { mode: 'boolean' }).notNull().default(false),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    error: text('error')
  },
  (t) => [index('idx_request_logs_date').on(t.logDate)]
)
