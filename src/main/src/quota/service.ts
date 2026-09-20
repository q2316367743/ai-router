/**
 * 余量查询服务：外置策略装载、单提供商/全量刷新、目录与列表组装。
 * 策略执行统一经 makeNativeContext（脚本策略在其 fetch 包装内再走完整脚本运行时）。
 */
import type { ProviderQuotaInfo, QuotaStrategyInfo, QuotaStrategyMeta } from '@common/types'
import { parseQuotaConfig } from '@common/utils/quotaConfig'
import { listProviders } from '$/db/repo/providerRepo'
import { listQuotaPlugins, listQuotaSnapshots, saveQuotaResult } from '$/db/repo/quotaRepo'
import { describeError } from './runtime/failure'
import {
  FETCH_TIMEOUT_MS,
  fetchByPlugin,
  makeNativeContext,
  normalizeSnapshot,
  withTimeout
} from './runtime/context'
import { evaluatePlugin } from './runtime/evaluate'
import { getStrategy, listStrategies, registerStrategy, unregisterStrategy } from './registry'

/** 启动/变更后重载全部外置策略：先清非内置条目，再逐个 eval 注册（跳过禁用行） */
export function reloadExternalStrategies(): void {
  for (const strategy of listStrategies()) {
    if (!strategy.meta.builtin) unregisterStrategy(strategy.meta.id)
  }
  for (const plugin of listQuotaPlugins()) {
    if (plugin.archivedAt !== null || !plugin.enabled) continue
    try {
      // 与内置脚本策略同一条运行时路径：fetchByPlugin 内部组装设置池 / origin 白名单 / prelude
      const loaded = evaluatePlugin(plugin.script)
      const meta: QuotaStrategyMeta = {
        id: plugin.id,
        label: plugin.name,
        builtin: false,
        credential: 'apiKey',
        description: '用户自定义脚本策略',
        settings: loaded.manifest.settings
      }
      registerStrategy({
        meta,
        fetch: (ctx) =>
          fetchByPlugin(loaded, { apiKey: ctx.apiKey, baseUrl: ctx.baseUrl, config: ctx.config })
      })
    } catch (err) {
      console.error(
        `[quota] 外置策略「${plugin.name}」加载失败：`,
        err instanceof Error ? err.message : err
      )
    }
  }
}

/**
 * 刷新一个（指定 id）或全部可查提供商的余量，结果落库；单家失败不影响其余。
 * 每家结果（成功/失败 + 耗时）都打 `[quota]` 日志——出站行为必须可观测，
 * 否则「尚未查询」无法区分是没轮到、查失败还是超时。
 */
export async function refreshProviderQuota(providerId?: string): Promise<void> {
  const targets = listProviders().filter(
    (provider) =>
      provider.quotaStrategyId !== null &&
      provider.archivedAt === null &&
      provider.enabled &&
      (providerId === undefined || provider.id === providerId)
  )
  if (targets.length === 0) {
    console.log(
      `[quota] 本轮刷新无目标（${providerId ? `providerId=${providerId}` : '未绑定策略、已停用或已归档'}）`
    )
    return
  }

  let succeeded = 0
  let failed = 0
  await Promise.all(
    targets.map(async (provider) => {
      const strategyId = provider.quotaStrategyId
      if (!strategyId) return
      const strategy = getStrategy(strategyId)
      if (!strategy) {
        failed++
        console.error(`[quota] ${provider.name}：策略 ${strategyId} 不存在或未启用，跳过`)
        saveQuotaResult(provider.id, { snapshot: null, error: '策略不存在或未启用' })
        return
      }
      const startedAt = Date.now()
      try {
        const ctx = makeNativeContext({
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          config: parseQuotaConfig(provider.strategyConfig)
        })
        // 整体超时兜底：脚本路径内部有 20s 超时，native 策略由这里统一保护
        const snapshot = normalizeSnapshot(
          await withTimeout(
            Promise.resolve(strategy.fetch(ctx)),
            FETCH_TIMEOUT_MS,
            `${provider.name} 余量查询`
          )
        )
        saveQuotaResult(provider.id, { snapshot, error: null })
        succeeded++
        console.log(
          `[quota] ${provider.name} ← ${strategy.meta.label} 刷新成功（${Date.now() - startedAt}ms）`
        )
      } catch (err) {
        const message = describeError(err)
        saveQuotaResult(provider.id, { snapshot: null, error: message })
        failed++
        console.error(
          `[quota] ${provider.name} ← ${strategy.meta.label} 刷新失败（${Date.now() - startedAt}ms）：${message}`
        )
      }
    })
  )
  console.log(`[quota] 本轮刷新完成：成功 ${succeeded} / 失败 ${failed} / 共 ${targets.length}`)
}

/** 余量页列表：绑定了策略的未归档提供商 + 最新快照（快照查库，零出站请求） */
export function listQuotaOverview(): ProviderQuotaInfo[] {
  const snapshots = new Map(listQuotaSnapshots().map((row) => [row.providerId, row]))
  return listProviders()
    .filter((provider) => provider.quotaStrategyId !== null && provider.archivedAt === null)
    .map((provider) => {
      const strategy = getStrategy(provider.quotaStrategyId ?? '')
      const row = snapshots.get(provider.id)
      return {
        providerId: provider.id,
        providerName: provider.name,
        kind: provider.kind,
        enabled: provider.enabled,
        strategyId: provider.quotaStrategyId,
        strategyLabel: strategy?.meta.label ?? provider.quotaStrategyId,
        snapshot: row?.snapshot ?? null,
        error: row?.error ?? null,
        queriedAt: row?.queriedAt ?? null
      }
    })
}

/** 策略目录：注册表全量 + 外置策略启停状态合并 */
export function listStrategyCatalog(): QuotaStrategyInfo[] {
  const plugins = new Map(listQuotaPlugins().map((plugin) => [plugin.id, plugin]))
  return listStrategies().map((strategy) => ({
    ...strategy.meta,
    enabled: strategy.meta.builtin ? true : (plugins.get(strategy.meta.id)?.enabled ?? false)
  }))
}

/** 安装/更新外置策略前的脚本校验：加载失败抛中文错误（IPC 直接透传给 UI） */
export function validatePluginScript(script: string): void {
  evaluatePlugin(script)
}

/** 删除归档策略后同步移出注册表的兜底入口 */
export function unregisterExternalStrategy(id: string): void {
  const strategy = getStrategy(id)
  if (strategy && !strategy.meta.builtin) unregisterStrategy(id)
}
