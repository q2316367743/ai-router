/**
 * 余量快照 → 额度阻断判定。
 *
 * 这是「不等请求失败再降级」的那一半：余量定时刷新（10 分钟一轮）落库后即时把
 * 「额度已用尽」的渠道可用度压到 0，请求根本不会被发给它。
 *
 * 判定口径（全部读快照，零出站）：
 * - 任一窗口 `usedPercent >= 100` 且未到 `resetsAt` → 阻断，解除时刻取该窗口的重置时间
 * - `cost.balance <= 0` → 阻断（余额型：DeepSeek 没钱的场景）
 * - `cost.used >= cost.limit`（有上限时）→ 阻断
 */
import type { QuotaRateWindow, QuotaSnapshot } from '@common/types'
import { currencyPrefix, windowTitleOf } from '@common/utils/quotaDisplay'
import type { QuotaBlock } from './types'

/** 窗口视为耗尽的已用百分比：策略侧已把 usedPercent 钳制到 0~100，等于 100 即没有余量 */
const EXHAUSTED_PERCENT = 100

/** 快照 → 阻断状态；返回 null 表示快照显示额度充足（可解除快照侧建立的阻断） */
export function evaluateQuota(snapshot: QuotaSnapshot, now = Date.now()): QuotaBlock | null {
  const windows = collectWindows(snapshot)
  const exhausted = windows.filter(({ window }) => isExhaustedWindow(window, now))
  if (exhausted.length > 0) {
    const labels = exhausted
      .map(({ fallback, window }) => windowTitleOf(fallback, window))
      .join(' / ')
    return {
      reason: `${labels}额度已用尽`,
      until: earliestReset(exhausted.map(({ window }) => window))
    }
  }

  const cost = snapshot.cost
  if (cost) {
    if (typeof cost.balance === 'number' && cost.balance <= 0) {
      return {
        reason: `账户余额已用尽（${currencyPrefix(cost.currency)}${cost.balance}）`,
        until: cost.resetsAt ?? null
      }
    }
    if (typeof cost.limit === 'number' && cost.limit > 0 && cost.used >= cost.limit) {
      return { reason: '额度已用尽（已用金额达到上限）', until: cost.resetsAt ?? null }
    }
  }
  return null
}

interface LabeledWindow {
  fallback: string
  window: QuotaRateWindow
}

function collectWindows(snapshot: QuotaSnapshot): LabeledWindow[] {
  const windows: LabeledWindow[] = []
  if (snapshot.primary) windows.push({ fallback: '主窗口', window: snapshot.primary })
  if (snapshot.secondary) windows.push({ fallback: '次窗口', window: snapshot.secondary })
  if (snapshot.tertiary) windows.push({ fallback: '第三窗口', window: snapshot.tertiary })
  for (const named of snapshot.extraWindows ?? []) {
    windows.push({ fallback: named.title, window: named.window })
  }
  return windows
}

/** `resetsAt` 已过 = 窗口已重置（快照是上一窗口的旧值），不再视为耗尽 */
function isExhaustedWindow(window: QuotaRateWindow, now: number): boolean {
  if (!(window.usedPercent >= EXHAUSTED_PERCENT)) return false
  return window.resetsAt == null || window.resetsAt > now
}

/** 多个窗口同时耗尽时取最早的重置时刻：那一刻起至少有一个维度恢复 */
function earliestReset(windows: QuotaRateWindow[]): number | null {
  const times = windows
    .map((window) => window.resetsAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return times.length > 0 ? Math.min(...times) : null
}
