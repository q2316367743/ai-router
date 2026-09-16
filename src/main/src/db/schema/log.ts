import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 请求详细日志：保留最近 7 天，logRepo 惰性清理（DELETE log_date < 窗口边界日）。
 *
 * 两阶段落库：请求进入转发前先 startLog 落一行 pending（finished_at / status / duration_ms 为 null），
 * 响应结束后 recordLog 以 request_id 为键回填。null 即「进行中」，不用哨兵值以免污染筛选口径。
 */
export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 请求 ID：每次请求入口生成的 UUID，同时是 pending 行回填的关联键（唯一索引） */
    requestId: text('request_id').notNull(),
    /** 日志归属日期（YYYY-MM-DD，由请求时间推导），清理依据 */
    logDate: text('log_date').notNull(),
    /** 请求 / 完成时间（epoch ms）；finished_at 为 null 表示请求进行中 */
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    publicModel: text('public_model').notNull(),
    providerName: text('provider_name').notNull(),
    upstreamModel: text('upstream_model').notNull(),
    /**
     * 归属供应商 / 模型映射 ID：仅供改名时精确圈定历史行（同名供应商不误伤）。
     * 可空：本次改动之前写入的行没有值；名字仍是唯一展示与筛选依据。
     */
    providerId: text('provider_id'),
    modelId: text('model_id'),
    path: text('path').notNull(),
    /** 响应状态码；本地拦截时为 400/401/404/502 等；null 表示请求进行中 */
    status: integer('status'),
    durationMs: integer('duration_ms'),
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
  (t) => [
    index('idx_request_logs_date').on(t.logDate),
    uniqueIndex('idx_request_logs_request_id').on(t.requestId)
  ]
)
