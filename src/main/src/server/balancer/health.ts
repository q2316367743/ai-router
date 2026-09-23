/**
 * 渠道可用度状态机（内存态，唯一事实源）。
 *
 * 可用度 0~100 = 该提供商当前分到的流量权重：
 * - **失败先大后小**：扣掉当前值的 10%（可用度越高扣得越多），不为 0 兜底在 `MIN_AVAILABILITY`；
 * - **成功后先小后大**：涨回当前值的 10%（可用度越低涨得越少），封顶 100；
 * - **额度耗尽直接归零**：不参与衰减，直接不给流量；
 * - **额度恢复直接拉满**：不逐点回涨。
 *
 * 状态只存内存：重启后可用度回到 100，但额度阻断会在启动时由落库的余量快照重建
 * （见 `quotaGuard.syncQuotaBlocks`），所以「没钱了」不会在重启后漏放行。
 */
import {
  DECAY_RATIO,
  INITIAL_AVAILABILITY,
  MIN_AVAILABILITY,
  MIN_STEP,
  QUOTA_BLOCK_MAX_MS,
  QUOTA_BLOCK_TTL_MS,
  RECOVER_RATIO
} from './config'
import type { ChannelHealth, QuotaBlock, QuotaBlockSource } from './types'

const channels = new Map<string, ChannelHealth>()

/** 取活对象（内部变更用）；不存在的提供商按初始满值惰性建账 */
function stateOf(providerId: string): ChannelHealth {
  const existing = channels.get(providerId)
  if (existing) return existing
  const created: ChannelHealth = {
    providerId,
    availability: INITIAL_AVAILABILITY,
    quotaBlocked: false,
    blockReason: null,
    blockUntil: null,
    blockSource: null,
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastError: null,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastProbeAt: null
  }
  channels.set(providerId, created)
  return created
}

/**
 * 当前可用度（路由权重）：额度阻断期间为 0。
 *
 * 阻断到期（窗口 resetsAt 已过 / 推断 TTL 到点）在此自动解除并直接拉满——
 * 惰性判定意味着不需要为「窗口重置」单独排定时器。
 */
export function availabilityOf(providerId: string, now = Date.now()): number {
  const state = stateOf(providerId)
  if (!state.quotaBlocked) return state.availability
  if (state.blockUntil !== null && now >= state.blockUntil) {
    releaseQuotaBlock(state)
    return state.availability
  }
  return 0
}

/** 额度阻断原因（未阻断返回 null）：全渠道被拦时用于 503 文案与健康列展示 */
export function blockReasonOf(providerId: string): string | null {
  const state = channels.get(providerId)
  if (!state?.quotaBlocked) return null
  if (state.blockUntil !== null && Date.now() >= state.blockUntil) return null
  return state.blockReason
}

/** 派发记录：每次把请求交给该渠道时调用（探测器另写 lastProbeAt），用于判断渠道是否已断流 */
export function markAttempt(providerId: string, now = Date.now(), probe = false): void {
  const state = stateOf(providerId)
  state.lastAttemptAt = now
  if (probe) state.lastProbeAt = now
}

/** 该渠道是否该放一次探测：可用度已很低 + 距离上次派发超过冷却时间（有流量的渠道不需要探测） */
export function needsProbe(
  providerId: string,
  threshold: number,
  cooldownMs: number,
  now = Date.now()
): boolean {
  const state = stateOf(providerId)
  if (availabilityOf(providerId, now) <= 0) return false
  if (state.availability > threshold) return false
  if (state.lastAttemptAt === null) return true
  return now - state.lastAttemptAt >= cooldownMs
}

/** 请求成功：普通衰减中的渠道按「先小后大」回涨；额度阻断中的渠道直接拉满（能打通说明额度已恢复） */
export function reportSuccess(providerId: string, now = Date.now()): void {
  const state = stateOf(providerId)
  state.lastSuccessAt = now
  state.consecutiveFailures = 0
  if (state.quotaBlocked) {
    releaseQuotaBlock(state)
    return
  }
  if (state.availability >= INITIAL_AVAILABILITY) return
  state.lastError = null
  state.availability = Math.min(
    INITIAL_AVAILABILITY,
    state.availability + stepOf(state.availability, RECOVER_RATIO)
  )
}

/** 请求失败：按归类扣减；额度类失败直接阻断 */
export function reportFailure(
  providerId: string,
  kind: 'upstream' | 'auth' | 'quota',
  message: string,
  now = Date.now()
): void {
  const state = stateOf(providerId)
  state.lastFailureAt = now
  state.lastError = message
  state.consecutiveFailures += 1
  if (kind === 'quota') {
    applyQuotaBlock(
      providerId,
      { reason: message, until: now + QUOTA_BLOCK_TTL_MS },
      now,
      'response'
    )
    return
  }
  // 已被额度阻断的渠道不再叠加衰减（阻断是硬状态，可用度已经是 0）
  if (state.quotaBlocked) return
  state.availability = Math.max(
    MIN_AVAILABILITY,
    state.availability - stepOf(state.availability, DECAY_RATIO)
  )
}

/**
 * 应用余量快照的额度判定：`block` 非空 = 快照显示额度已耗尽；null = 快照显示健康。
 *
 * 快照查询失败时**不要调用**（无信息不等于健康）：网络抖动不该解除已有阻断。
 * 只有快照侧建立的阻断会被「快照显示健康」解除；响应推断的阻断等自己的 TTL 到期。
 */
export function applyQuotaBlock(
  providerId: string,
  block: QuotaBlock | null,
  now = Date.now(),
  source: QuotaBlockSource = 'snapshot'
): void {
  const state = stateOf(providerId)
  if (block) {
    const until = Math.min(
      block.until ?? Number.POSITIVE_INFINITY,
      now + (source === 'snapshot' ? QUOTA_BLOCK_MAX_MS : QUOTA_BLOCK_TTL_MS)
    )
    state.quotaBlocked = true
    state.blockReason = block.reason
    state.blockUntil = Number.isFinite(until) ? until : null
    state.blockSource = source
    state.availability = 0
    state.lastError = block.reason
    return
  }
  if (state.quotaBlocked && state.blockSource === 'snapshot') releaseQuotaBlock(state)
}

/** 手动重置（设置页 / 健康列逃生口：充值后不想等下一轮刷新） */
export function resetChannel(providerId: string): void {
  const state = stateOf(providerId)
  state.availability = INITIAL_AVAILABILITY
  state.consecutiveFailures = 0
  state.lastError = null
  releaseQuotaBlock(state)
}

/** 渠道健康快照（副本，供 IPC 与应用内展示） */
export function healthSnapshot(providerId: string): ChannelHealth {
  const state = stateOf(providerId)
  return { ...state, availability: availabilityOf(providerId) }
}

/** 全部已知渠道的健康快照（副本） */
export function listChannelHealth(): ChannelHealth[] {
  return [...channels.keys()].map((providerId) => healthSnapshot(providerId))
}

/** 解除额度阻断：直接拉满（额度恢复不逐点回涨） */
function releaseQuotaBlock(state: ChannelHealth): void {
  if (!state.quotaBlocked) return
  state.quotaBlocked = false
  state.blockReason = null
  state.blockUntil = null
  state.blockSource = null
  state.availability = INITIAL_AVAILABILITY
}

/** 单步幅度：按比例取，不足 `MIN_STEP` 时按 `MIN_STEP`（低可用度才有实际效果） */
function stepOf(availability: number, ratio: number): number {
  return Math.max(MIN_STEP, availability * ratio)
}
