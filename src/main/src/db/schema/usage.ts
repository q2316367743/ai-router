import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 每日使用量统计：永久保留，按日期 × 对外模型聚合累加 */
export const usageDaily = sqliteTable(
  'usage_daily',
  {
    date: text('date').notNull(),
    publicModel: text('public_model').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.date, t.publicModel] })]
)
