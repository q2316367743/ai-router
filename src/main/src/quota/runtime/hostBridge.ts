/**
 * 脚本宿主桥（host）：prelude 里的 ctx.http / ctx.settings / ctx.cache 等便捷层
 * 全部落到这里的 host.* 实现。HTTP 通道统一走 getUpstreamClient（复用出站代理与
 * 网络错误增强），脚本请求受 manifest 端点 origin 白名单约束，认证头由宿主附加。
 */
import type { PluginManifest } from './evaluate'
import { makeFailure } from './failure'
import { getUpstreamClient } from '$/server/upstream/httpClient'

/** 响应体上限（与 CodexBar 一致 5MB），防异常上游拖爆内存 */
const MAX_BODY_BYTES = 5 * 1024 * 1024
/** 引擎内缓存 TTL 上限（秒） */
const CACHE_TTL_MAX = 86_400

export interface HostBridgeInputs {
  manifest: PluginManifest
  /** plain 设置池（settings.get 的取值空间，含附加配置） */
  settings: Record<string, string>
  /** secure 设置池（auth 附加 + settings.getSecret） */
  secrets: Record<string, string>
  /** 手贴的浏览器 Cookie 头（strategyConfig.cookie）；null = 未配置 */
  cookieHeader: string | null
  /** 本次执行的 origin 白名单（static + setting 端点解析结果） */
  allowedOrigins: string[]
}

/** host.http 的 opts 形状（prelude 已把 body 序列化为 bodyJSON） */
interface HttpOpts {
  headers?: Record<string, string>
  timeoutSeconds?: number
  bodyJSON?: string
}

const cache = new Map<string, { value: string; expireAt: number }>()

export function createHostBridge(inputs: HostBridgeInputs): Record<string, unknown> {
  const { manifest, settings, secrets, cookieHeader, allowedOrigins } = inputs

  const declaredSettingKeys = new Set(manifest.settings.map((item) => item.key))

  function settingGet(key: string, secure: boolean): string | null {
    if (!declaredSettingKeys.has(key)) {
      throw new Error(`插件未声明设置项 ${key}，拒绝读取`)
    }
    const value = (secure ? secrets[key] : settings[key]) ?? ''
    return value.trim() ? value.trim() : null
  }

  function assertAllowedOrigin(url: string): void {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      throw new Error(`非法请求地址：${url}`)
    }
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      throw new Error(`请求端点 ${origin} 不在插件声明的 endpoints 白名单内`)
    }
  }

  /** 按插件 auth 声明附加认证头（脚本设置的同名头会被覆盖） */
  function authHeaders(): Record<string, string> {
    const auth = manifest.auth
    if (!auth) return {}
    const value = secrets[auth.secret]?.trim()
    if (!value) return {}
    switch (auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${value}` }
      case 'x-api-key':
        return { 'X-API-Key': value }
      case 'header':
        return auth.header ? { [auth.header]: value } : {}
      case 'authorization-scheme':
        return { Authorization: `${auth.scheme ?? 'Bearer'} ${value}` }
    }
  }

  function http(
    rawUrl: string,
    opts: HttpOpts,
    method: string,
    wantsJSON: boolean,
    resolve: (value: Record<string, unknown>) => void,
    reject: (err: Error) => void
  ): void {
    try {
      const upper = method.toUpperCase()
      if (upper !== 'GET' && upper !== 'POST') throw new Error(`不支持的请求方法：${method}`)
      assertAllowedOrigin(rawUrl)

      const timeout = Math.min(30, Math.max(1, Number(opts.timeoutSeconds) || 15)) * 1000
      getUpstreamClient()
        .request<string>({
          url: rawUrl,
          method: upper,
          headers: { ...opts.headers, ...authHeaders() },
          data: upper === 'POST' && typeof opts.bodyJSON === 'string' ? opts.bodyJSON : undefined,
          timeout,
          responseType: 'text',
          validateStatus: () => true,
          maxContentLength: MAX_BODY_BYTES,
          maxBodyLength: MAX_BODY_BYTES
        })
        .then((res) => {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers[key.toLowerCase()] = value
            else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ')
          }
          const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
          if (!wantsJSON) {
            resolve({ status: res.status, headers, bodyText })
            return
          }
          try {
            resolve({ status: res.status, headers, json: bodyText ? JSON.parse(bodyText) : null })
          } catch {
            reject(makeFailure('parse-failure', `响应不是合法 JSON（HTTP ${res.status}）`))
          }
        })
        .catch((err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)))
        })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return {
    http,
    settingGet,
    cookieHeader: (domain: string, resolve: (value: string) => void, reject: (err: Error) => void): void => {
      if (!manifest.cookieDomains.some((declared) => domain === declared || domain.endsWith(`.${declared}`))) {
        reject(new Error(`插件未声明 Cookie 域 ${domain}，拒绝读取`))
        return
      }
      if (!cookieHeader) {
        reject(makeFailure('missing-credential', `请在提供商的附加配置中粘贴 ${domain} 的 Cookie 头`))
        return
      }
      resolve(cookieHeader)
    },
    cacheGet: (key: string): string | null => {
      const hit = cache.get(key)
      if (!hit) return null
      if (hit.expireAt < Date.now()) {
        cache.delete(key)
        return null
      }
      return hit.value
    },
    cacheSet: (key: string, value: string, ttlSeconds: number): void => {
      const ttl = Math.min(CACHE_TTL_MAX, Math.max(1, Number(ttlSeconds) || 60))
      cache.set(key, { value: String(value), expireAt: Date.now() + ttl * 1000 })
    },
    log: (...args: string[]): void => {
      // 脱敏：secure 设置值不出现在日志
      let text = args.join(' ')
      for (const secret of Object.values(secrets)) {
        if (secret) text = text.split(secret).join('<redacted>')
      }
      console.log(`[quota:${manifest.id}]`, text)
    },
    nextDailyReset: (timeZone: string, hour: number): number => nextDailyReset(timeZone, Number(hour) || 0),
    pct: (used: number, limit: number): number => {
      const nUsed = Number(used)
      const nLimit = Number(limit)
      if (!Number.isFinite(nUsed) || !Number.isFinite(nLimit) || nLimit <= 0) return 0
      return Math.min(100, Math.max(0, (nUsed / nLimit) * 100))
    },
    amountFromPercent: (percent: number, limit: number): number => (Number(limit) * Number(percent)) / 100,
    isDetailLabel: (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 40
  }
}

/** 时区在某时刻的 UTC 偏移（ms），供跨时区日界换算 */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .formatToParts(date)
    .reduce<Record<string, number>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = Number(part.value)
      return acc
    }, {})
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  return asUTC - date.getTime()
}

/** 目标时区当前日界（年/月/日），供 nextDailyReset 计算跨时区零点 */
function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false
  })
    .formatToParts(date)
    .reduce<Record<string, number>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = Number(part.value)
      return acc
    }, {})
  return { year: parts.year, month: parts.month, day: parts.day }
}

/** 指定时区「下一个 hour 点整」的 epoch ms（已过期则顺延一天） */
function nextDailyReset(timeZone: string, hour: number): number {
  const now = Date.now()
  const hourClamped = Math.min(23, Math.max(0, Math.trunc(hour)))
  const { year, month, day } = zonedDateParts(new Date(now), timeZone)
  // 先用目标日 noon 估 offset，再求该日 hour 点的精确时刻（DST 折返误差可忽略）
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const base = Date.UTC(year, month - 1, day + dayOffset, 12)
    const offset = timeZoneOffsetMs(new Date(base), timeZone)
    const reset = Date.UTC(year, month - 1, day + dayOffset, hourClamped) - offset
    if (reset > now) return reset
  }
  return now + 86_400_000
}
