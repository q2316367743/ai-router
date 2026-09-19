import { nanoid } from 'nanoid'
import { LRUCache } from 'lru-cache'
import { eq } from 'drizzle-orm'
import type { ServiceConfig } from '@common/types'
import { db } from '../client'
import { settings } from '../schema'

const KEY_PORT = 'server.port'
const KEY_API_KEY = 'server.apiKey'
const KEY_ENABLED = 'server.enabled'
const KEY_PROXY_URL = 'server.proxyUrl'

const DEFAULT_PORT = 8910

// 服务配置缓存：读多写少（鉴权/出站代理每请求都读），惰性加载，写操作后失效。
// 单值槽位（max 1 固定 key）；配置类数据本进程是唯一写者，写时失效已保证一致性，不设 TTL
const configCache = new LRUCache<string, ServiceConfig>({ max: 1 })
const CONFIG_CACHE_KEY = 'service-config'

/** 首次启动补齐默认配置：端口 8910、生成 sk- 对外 Key、服务开启 */
export function ensureServiceDefaults(): void {
  const config = getServiceConfig()
  const rows: Array<{ key: string; value: string }> = []
  if (!config.port) rows.push({ key: KEY_PORT, value: String(DEFAULT_PORT) })
  if (!config.apiKey) rows.push({ key: KEY_API_KEY, value: `sk-${nanoid(32)}` })
  rows.push({ key: KEY_ENABLED, value: config.enabled ? '1' : '0' })
  if (rows.length) {
    db().insert(settings).values(rows).onConflictDoNothing().run()
    configCache.clear()
  }
}

export function getServiceConfig(): ServiceConfig {
  const cached = configCache.get(CONFIG_CACHE_KEY)
  if (cached) return cached
  const rows = db().select().from(settings).all()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const port = Number(map.get(KEY_PORT) ?? 0)
  const config: ServiceConfig = {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    apiKey: map.get(KEY_API_KEY) ?? '',
    enabled: (map.get(KEY_ENABLED) ?? '1') === '1',
    proxyUrl: map.get(KEY_PROXY_URL) ?? ''
  }
  configCache.set(CONFIG_CACHE_KEY, config)
  return config
}

export function saveServiceConfig(config: ServiceConfig): void {
  upsert(KEY_PORT, String(config.port))
  upsert(KEY_ENABLED, config.enabled ? '1' : '0')
  upsert(KEY_PROXY_URL, config.proxyUrl.trim())
  configCache.clear()
}

/** 重新生成对外 Key，返回新 Key */
export function regenerateApiKey(): string {
  const apiKey = `sk-${nanoid(32)}`
  upsert(KEY_API_KEY, apiKey)
  configCache.clear()
  return apiKey
}

function upsert(key: string, value: string): void {
  db()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

/** 通用键值读（UI 偏好类配置）：键不存在返回 null；读频低，不走 service 配置缓存 */
export function getSetting(key: string): string | null {
  const row = db().select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? null
}

/** 通用键值写：写后清 service 配置缓存，防止通用键与 service 键交叉时读到旧值 */
export function setSetting(key: string, value: string): void {
  upsert(key, value)
  configCache.clear()
}
