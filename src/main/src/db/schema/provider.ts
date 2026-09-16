import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 提供商：OpenAI 兼容上游服务（baseUrl + apiKey） */
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('idx_providers_name').on(t.name)]
)
