/**
 * 策略执行上下文组装：把提供商凭证 + 插件 manifest + 宿主桥组装成一次可执行的 fetch。
 * 外置脚本走 prelude 便捷层；内置 TS 策略复用同一 http 通道（无白名单约束）。
 */
import type { QuotaRateWindow, QuotaSnapshot, QuotaStrategyContext } from '@common/types'
import { createHostBridge } from './hostBridge'
import type { LoadedPlugin, PluginManifest } from './evaluate'
import { makeFailure } from './failure'
import preludeSource from './provider-plugin-prelude.js?raw'

/** fetchUsage 整体超时（Node 无法中断已执行的脚本，超时后放弃等待该次结果） */
export const FETCH_TIMEOUT_MS = 20_000

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeFailure('provider-unavailable', `${label} 超时（${Math.round(ms / 1000)}s）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

/** setting 型端点访问策略：允许 http 的范围仅限本机回环 */
function isAllowedByPolicy(origin: string, policy: string): boolean {
  if (policy === 'https-or-loopback-http' || policy === 'https-or-private-network-http') {
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  }
  return origin.startsWith('https://')
}

/** 运行时解析端点白名单：字符串端点 + setting 型端点（从设置池取 URL） */
function resolveAllowedOrigins(
  manifest: PluginManifest,
  pool: Record<string, string>
): string[] {
  const origins = [...manifest.staticOrigins]
  for (const item of manifest.settingOrigins) {
    const value = pool[item.key]?.trim()
    if (!value) continue
    try {
      const origin = new URL(value).origin
      if (isAllowedByPolicy(origin, item.policy)) origins.push(origin)
    } catch {
      // 配置值不是合法 URL：忽略，白名单不含它
    }
  }
  return origins
}

/** 窗口字段规范化：resetsAt 兼容 Date / epoch 秒 / epoch 毫秒 / ISO 字符串，统一 epoch ms */
function normalizeWindow(raw: QuotaRateWindow | null | undefined): QuotaRateWindow | null {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.usedPercent))) return null
  let resetsAt: number | null = null
  const input: unknown = raw.resetsAt
  if (input instanceof Date) resetsAt = input.getTime()
  else if (typeof input === 'string') {
    const parsed = new Date(input)
    if (!Number.isNaN(parsed.getTime())) resetsAt = parsed.getTime()
  } else if (typeof input === 'number' && Number.isFinite(input)) {
    resetsAt = input < 1e12 ? input * 1000 : input
  }
  return {
    usedPercent: Math.min(100, Math.max(0, Number(raw.usedPercent))),
    windowMinutes: typeof raw.windowMinutes === 'number' && raw.windowMinutes > 0 ? raw.windowMinutes : null,
    resetsAt,
    resetDescription: typeof raw.resetDescription === 'string' ? raw.resetDescription : null
  }
}

/** 快照规范化与有效性校验：至少含一项有意义数据，窗口字段做类型收敛 */
export function normalizeSnapshot(raw: unknown): QuotaSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw makeFailure('parse-failure', '策略返回结果不是对象')
  }
  const source = raw as Record<string, unknown>
  const snapshot: QuotaSnapshot = {
    primary: normalizeWindow(source.primary as QuotaRateWindow | undefined),
    secondary: normalizeWindow(source.secondary as QuotaRateWindow | undefined),
    tertiary: normalizeWindow(source.tertiary as QuotaRateWindow | undefined),
    cost:
      typeof source.cost === 'object' && source.cost !== null
        ? (source.cost as QuotaSnapshot['cost'])
        : null,
    identity:
      typeof source.identity === 'object' && source.identity !== null
        ? (source.identity as QuotaSnapshot['identity'])
        : null,
    details: Array.isArray(source.details) ? (source.details as QuotaSnapshot['details']) : null,
    extraWindows: Array.isArray(source.extraWindows)
      ? (source.extraWindows as QuotaSnapshot['extraWindows'])
      : null
  }
  const meaningful =
    snapshot.primary ||
    snapshot.secondary ||
    snapshot.tertiary ||
    snapshot.cost ||
    (snapshot.extraWindows && snapshot.extraWindows.length > 0) ||
    (snapshot.details && snapshot.details.length > 0)
  if (!meaningful) {
    throw makeFailure('parse-failure', '策略未返回任何窗口、余额或明细数据')
  }
  return snapshot
}

export interface ExecInputs {
  apiKey: string
  baseUrl: string
  /** strategyConfig 解析后的附加配置（cookie / 区域 / 附加 token 等） */
  config: Record<string, string>
}

/** 内置 TS 策略的上下文：与脚本完全同构（同一宿主桥 + prelude 便捷层），无 origin 白名单 */
export function makeNativeContext(inputs: ExecInputs): QuotaStrategyContext {
  const settingsPool: Record<string, string> = { ...inputs.config }
  if (inputs.baseUrl) settingsPool.BASE_URL ??= inputs.baseUrl
  const bridge = createHostBridge({
    manifest: {
      id: 'native',
      label: 'native',
      settings: Object.keys(settingsPool).map((key) => ({ key, title: key, type: 'plain' as const })),
      auth: null,
      capabilities: [],
      cookieDomains: [],
      staticOrigins: [],
      settingOrigins: []
    },
    settings: settingsPool,
    secrets: { ...inputs.config, apiKey: inputs.apiKey },
    cookieHeader: inputs.config.cookie ?? null,
    allowedOrigins: []
  })
  const ctx: Record<string, unknown> = {
    apiKey: inputs.apiKey,
    baseUrl: inputs.baseUrl,
    config: inputs.config,
    env: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    __codexbarNowMillis: String(Date.now())
  }
  applyPreludeToContext(ctx, bridge)
  return ctx as unknown as QuotaStrategyContext
}

/** 执行外置脚本策略：组装设置池与白名单 → prelude 注入 → fetchUsage → 快照规范化 */
export async function fetchByPlugin(plugin: LoadedPlugin, inputs: ExecInputs): Promise<QuotaSnapshot> {
  const { manifest } = plugin
  // 设置池：附加配置全量进 plain；secure 池 = 附加配置 + auth.secret ← 提供商 API Key
  const settingsPool: Record<string, string> = { ...inputs.config }
  if (inputs.baseUrl) settingsPool.BASE_URL ??= inputs.baseUrl
  const secretsPool: Record<string, string> = { ...inputs.config }
  if (manifest.auth && inputs.apiKey.trim()) secretsPool[manifest.auth.secret] = inputs.apiKey.trim()

  const bridge = createHostBridge({
    manifest,
    settings: settingsPool,
    secrets: secretsPool,
    cookieHeader: inputs.config.cookie ?? null,
    allowedOrigins: resolveAllowedOrigins(manifest, { ...settingsPool, ...secretsPool })
  })

  const ctx: Record<string, unknown> = {
    apiKey: inputs.apiKey,
    baseUrl: inputs.baseUrl,
    config: inputs.config,
    env: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    __codexbarNowMillis: String(Date.now())
  }
  applyPreludeToContext(ctx, bridge)

  const result = await withTimeout(
    Promise.resolve(plugin.fetchUsage(ctx)),
    FETCH_TIMEOUT_MS,
    `策略 ${manifest.label} 执行`
  )
  return normalizeSnapshot(result)
}

let cachedApply: ((ctx: Record<string, unknown>, host: Record<string, unknown>) => void) | null = null

/** 求值 prelude（编译一次缓存），把 http/settings/date/fail 等便捷层注入 ctx */
function applyPreludeToContext(ctx: Record<string, unknown>, host: Record<string, unknown>): void {
  if (!cachedApply) {
    const apply = (0, eval)(preludeSource) as unknown
    if (typeof apply !== 'function') throw new Error('插件 prelude 加载失败：不是可执行函数')
    cachedApply = apply as (ctx: Record<string, unknown>, host: Record<string, unknown>) => void
  }
  cachedApply(ctx, host)
}
