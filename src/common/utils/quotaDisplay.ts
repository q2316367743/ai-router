/**
 * 余量快照的展示派生：分档阈值与窗口名归一。
 *
 * 阈值只留一份 —— 主窗口余量页（进度条填充色）与托盘额度卡（stat-* 分档类）共用，
 * 避免两处口径漂移；本文件不出现任何色值，档位到颜色的映射由展示层各自决定。
 */
import type { QuotaRateWindow } from '../types/quota'

/** 指标好坏档位（与用量看板的 StatSeverity 同构；额度域不引入统计依赖，故单独声明） */
export type QuotaSeverity = 'good' | 'fair' | 'poor'

/**
 * 百分比型分档：入参是「已用」百分比（剩余越少越危险）。
 * ≥90 差 / ≥70 中 / 其余好，与余量页进度条的分段一致。
 */
export function quotaWindowSeverity(usedPercent: number): QuotaSeverity {
  if (usedPercent >= 90) return 'poor'
  if (usedPercent >= 70) return 'fair'
  return 'good'
}

/** 余额型分档：低于阈值差，否则好（余额没有上限，无法按比例分档） */
export function balanceSeverity(balance: number, threshold: number): QuotaSeverity {
  return balance < threshold ? 'poor' : 'good'
}

/** 已用百分比 → 剩余百分比（夹紧到 0~100，四舍五入到一位小数） */
export function remainingPercent(usedPercent: number): number {
  const clamped = Math.min(100, Math.max(0, usedPercent))
  return Math.round((100 - clamped) * 10) / 10
}

/** 币种 → 展示前缀（USD → $、CNY/RMB → ¥、其余原样带空格） */
export function currencyPrefix(currency: string): string {
  const code = currency.toUpperCase()
  if (code === 'USD') return '$'
  if (code === 'CNY' || code === 'RMB') return '¥'
  return currency ? `${currency} ` : ''
}

/** 百分比数值 → 文本（整数不带小数，否则保留一位） */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * 窗口标题按 windowMinutes 归一（5 小时 / 每日 / 每周 / 每月），
 * 无窗口时长时回退策略给的说明或序号名。
 */
export function windowTitleOf(fallback: string, win: QuotaRateWindow): string {
  const minutes = win.windowMinutes
  if (!minutes) return win.resetDescription || fallback
  if (minutes === 300) return '5 小时'
  if (minutes === 24 * 60) return '每日'
  if (minutes === 7 * 24 * 60) return '每周'
  if (minutes === 30 * 24 * 60) return '每月'
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}
