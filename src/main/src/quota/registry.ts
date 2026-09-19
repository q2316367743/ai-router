/**
 * 余量策略注册表：内存 Map——内置策略（代码写死，启动时注册，不可卸载不可删除）与
 * 外置策略（用户 JS 脚本，安装/启动时 eval 后 set、归档时 delete）统一在此。
 */
import type { QuotaStrategy } from '@common/types'

const registry = new Map<string, QuotaStrategy>()

export function registerStrategy(strategy: QuotaStrategy): void {
  if (!strategy.meta?.id || typeof strategy.fetch !== 'function') {
    throw new Error('策略不合法：缺少 meta.id 或 fetch 方法')
  }
  if (registry.has(strategy.meta.id) && strategy.meta.builtin) {
    throw new Error(`内置策略 id 冲突：${strategy.meta.id}`)
  }
  registry.set(strategy.meta.id, strategy)
}

export function unregisterStrategy(id: string): void {
  const existing = registry.get(id)
  // 内置策略不可卸载：误删保护
  if (existing?.meta.builtin) return
  registry.delete(id)
}

export function getStrategy(id: string): QuotaStrategy | null {
  return registry.get(id) ?? null
}

/** 全量目录（内置在前）：外置策略的 enabled 状态由调用方结合 DB 合并 */
export function listStrategies(): QuotaStrategy[] {
  return [...registry.values()].sort((a, b) => Number(b.meta.builtin) - Number(a.meta.builtin))
}
