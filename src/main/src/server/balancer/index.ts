/**
 * 负载均衡引擎对外入口：候选排序、成败上报、额度同步、健康快照。
 *
 * 引擎只做决策与状态，不碰 HTTP：请求执行与改道循环在 `server/strategies/forward.ts`。
 */
import type { QuotaSnapshot } from '@common/types'
import { listQuotaSnapshots } from '$/db/repo/quotaRepo'
import { getBalancerConfig } from './config'
import { applyQuotaBlock, healthSnapshot, resetChannel } from './health'
import { evaluateQuota } from './quotaGuard'

export {
  BALANCER_SETTING_KEY,
  DEFAULT_BALANCER_CONFIG,
  MAX_ATTEMPTS_LIMIT,
  getBalancerConfig
} from './config'
export type { BalancerConfig } from './config'
export { classifyFailure, isPenalizing, isRetryable } from './classify'
export {
  availabilityOf,
  blockReasonOf,
  healthSnapshot,
  listChannelHealth,
  markAttempt,
  reportFailure,
  reportSuccess,
  resetChannel
} from './health'
export { evaluateQuota } from './quotaGuard'
export { orderCandidates } from './selector'
export {
  bindSession,
  boundProviderOf,
  clearSessionBindings,
  displaySessionKey,
  sessionKeyOf
} from './session'
export type { AttemptKind, ChannelHealth, QuotaBlock } from './types'

/**
 * 应用单家提供商的余量快照：额度耗尽即阻断，恢复即拉满。
 *
 * - `snapshot` 为 null（查询失败）时不动状态：无信息不等于健康，不该解除已有阻断；
 * - 总开关关闭时不作判定，并解除该渠道已有的额度阻断（否则它仍是 0 可用度、等于继续拦截）。
 */
export function applyProviderQuota(providerId: string, snapshot: QuotaSnapshot | null): void {
  if (!getBalancerConfig().quotaGuard) {
    if (healthSnapshot(providerId).quotaBlocked) resetChannel(providerId)
    return
  }
  if (!snapshot) return
  applyQuotaBlock(providerId, evaluateQuota(snapshot, Date.now()))
}

/**
 * 用落库的余量快照重建额度阻断（启动时调用一次）。
 *
 * 让「额度已用尽」跨重启存活：否则重启后可用度全部回到 100，
 * 头几个请求会被送去已经没钱的渠道。
 */
export function syncQuotaBlocks(): void {
  for (const row of listQuotaSnapshots()) {
    applyProviderQuota(row.providerId, row.snapshot)
  }
}
