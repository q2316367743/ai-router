/**
 * 负载均衡健康度的展示派生：分档阈值与文案只留一份，映射页与设置页共用，
 * 避免两处口径漂移；本文件不出现任何色值，档位到颜色的映射由展示层各自决定。
 */
import type { ChannelState } from '../types/balancer'

/**
 * 状态分档：额度阻断最严重，其次是已衰减的渠道。
 *
 * 可用度满值即健康；低于满值说明近期有过失败（扣减是乘性的，恢复也是），
 * 具体数值由 UI 一并展示，分档只用于配色与徽标。
 */
export function channelStateOf(availability: number): ChannelState {
  if (availability <= 0) return 'blocked'
  return availability >= 100 ? 'healthy' : 'degraded'
}

/** 档位 → 文案 */
export const CHANNEL_STATE_LABEL: Record<ChannelState, string> = {
  healthy: '正常',
  degraded: '降级中',
  blocked: '额度耗尽'
}

/** 可用度 → 数值文本（保留一位小数，整数不补零） */
export function formatAvailability(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * 组内占比：可用度在该组参与分流的渠道间的权重占比，即该渠道被选为**首次尝试**渠道的概率。
 *
 * 与引擎 `weightedShuffle` 的不放回抽样同源（`P(i) = w_i / Σw`），所以它直接回答「请求会发给谁」；
 * 但会话亲和（绑定渠道排第一）与探针（优先给已断流的降级渠道）会在此之上产生偏移，
 * 展示时须按「推算」口径说明。全组可用度都是 0（全部额度阻断）时返回全 0——
 * 那种情况下引擎直接回 503，没有任何渠道会拿到流量。
 */
export function routeShares(availabilities: number[]): number[] {
  const total = availabilities.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return availabilities.map(() => 0)
  return availabilities.map((value) => Math.max(0, value) / total)
}

/**
 * 阻断解除时刻 → 文案：「5 分钟后自动解除」/「等待余量刷新后解除」。
 * 窗口没有 resetsAt 的额度（如余额耗尽）只能靠下一轮快照刷新解除。
 */
export function blockUntilText(blockUntil: number | null, now = Date.now()): string {
  if (blockUntil === null) return '等待余量刷新后解除'
  const remain = blockUntil - now
  if (remain <= 0) return '即将解除'
  const minutes = Math.ceil(remain / 60_000)
  if (minutes < 60) return `${minutes} 分钟后自动解除`
  return `${Math.ceil(minutes / 60)} 小时后自动解除`
}
