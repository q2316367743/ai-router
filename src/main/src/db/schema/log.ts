import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 请求详细日志：保留最近 7 天，logRepo 惰性清理（DELETE log_date < 窗口边界日） */
export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 请求 ID：每次请求入口生成的 UUID，用于关联排查 */
    requestId: text('request_id').notNull(),
    /** 日志归属日期（YYYY-MM-DD，由请求时间推导），清理依据 */
    logDate: text('log_date').notNull(),
    /** 请求 / 完成时间（epoch ms） */
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at').notNull(),
    publicModel: text('public_model').notNull(),
    providerName: text('provider_name').notNull(),
    upstreamModel: text('upstream_model').notNull(),
    path: text('path').notNull(),
    /** 响应状态码；本地拦截时为 400/401/404/502 等 */
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    stream: integer('stream', { mode: 'boolean' }).notNull().default(false),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** 提供商未返回用量时的兜底估算值（基于请求正文估算） */
    unrecognizedTokens: integer('unrecognized_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    /** 请求正文（JSON 文本） */
    requestBody: text('request_body'),
    /** 请求标头（JSON 文本，已剔除鉴权字段） */
    requestHeaders: text('request_headers'),
    /** 响应正文（非流式为 JSON 文本；流式为全部 SSE 文本） */
    responseBody: text('response_body'),
    /** 响应标头（JSON 文本，上游响应头，已剔除 set-cookie） */
    responseHeaders: text('response_headers'),
    error: text('error')
  },
  (t) => [index('idx_request_logs_date').on(t.logDate)]
)
