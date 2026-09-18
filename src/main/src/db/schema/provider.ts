import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ProviderProtocol } from '@common/types'

/** 提供商：上游 AI 服务（protocol 决定接口协议，baseUrl + apiKey 决定目标与认证） */
export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    protocol: text('protocol')
      .$type<ProviderProtocol>()
      .notNull()
      .default('openai'),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 归档时间（epoch ms）：非空 = 已归档 —— 对外不可见（/v1/models 移除、请求报 model_archived）。
     * 与 enabled 正交：归档不改 enabled，恢复后原启用状态回来。
     */
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('idx_providers_name').on(t.name)]
)
