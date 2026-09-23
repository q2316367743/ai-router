/**
 * 负载均衡配置的宽松解析：**主进程读库与设置页读设置共用同一口径**，
 * 避免「界面显示一套、引擎跑另一套」（例如界面把 maxAttempts 钳到 5、引擎却收下 50）。
 */
import { DEFAULT_BALANCER_CONFIG, MAX_ATTEMPTS_LIMIT, type BalancerConfig } from '../types/balancer'

/** 任意来源的值 → 合法配置：键缺失、类型不对、越界一律回落默认值或钳制 */
export function parseBalancerConfig(value: unknown): BalancerConfig {
  if (typeof value !== 'object' || value === null) return DEFAULT_BALANCER_CONFIG
  const record = value as Record<string, unknown>
  return {
    enabled: boolOf(record['enabled'], DEFAULT_BALANCER_CONFIG.enabled),
    sessionAffinity: boolOf(record['sessionAffinity'], DEFAULT_BALANCER_CONFIG.sessionAffinity),
    quotaGuard: boolOf(record['quotaGuard'], DEFAULT_BALANCER_CONFIG.quotaGuard),
    maxAttempts: clampAttempts(record['maxAttempts'])
  }
}

function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BALANCER_CONFIG.maxAttempts
  }
  return Math.min(MAX_ATTEMPTS_LIMIT, Math.max(1, Math.round(value)))
}
