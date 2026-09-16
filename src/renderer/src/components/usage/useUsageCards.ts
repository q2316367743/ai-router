/**
 * 看板四张统计卡的展示配置。
 *
 * 把「哪个指标配哪个图标、胶囊怎么写、卡内迷你图画什么」从模板里抽出来，模板只负责遍历渲染。
 * 阈值与档位判定仍全部来自 useUsageStats（本文件不重复定义任何阈值，只做文案与图元选择）。
 */
import { computed, type ComputedRef } from 'vue'
import {
  REQUEST_MAGNITUDE_THRESHOLDS,
  TOKEN_MAGNITUDE_THRESHOLDS,
  latencySeverity,
  magnitudeLevel,
  successSeverity,
  type StatMagnitude,
  type StatSeverity,
  type UseUsageStatsResult
} from './useUsageStats'
import { tokenParts } from '@/utils/format'

type PillTheme = 'default' | 'primary' | 'warning' | 'danger' | 'success'

export interface StatPill {
  text: string
  theme: PillTheme
}

/** 卡内迷你图：bars 用逐桶数值，progress 用比例；两者都不画坐标轴与刻度 */
type CardViz = { kind: 'bars'; values: number[] } | { kind: 'progress'; percent: number }

export interface UsageCardConfig {
  key: string
  label: string
  /** tdesign 图标名（不手写 SVG） */
  icon: string
  value: number
  unit: string
  /** 显式给出小数位，避免依赖 t-statistic 的默认格式 */
  decimalPlaces: number
  /** 无数据（如零请求下的成功率）时为 false，模板渲染占位符而不是「0」 */
  hasValue: boolean
  pill: StatPill | null
  /** 分档类：同时决定数值颜色与卡片渐晕，空串表示不分档 */
  levelClass: string
  viz: CardViz | null
  footer: string
}

/** 延迟迷你进度条的满格基准：与 latencySeverity 的差档阈值保持一致 */
const LATENCY_LIMIT_MS = 5_000

const SUCCESS_PILL: Record<StatSeverity, StatPill> = {
  good: { text: '优秀', theme: 'success' },
  fair: { text: '尚可', theme: 'warning' },
  poor: { text: '偏低', theme: 'danger' }
}

const LATENCY_PILL: Record<StatSeverity, StatPill> = {
  good: { text: '很快', theme: 'success' },
  fair: { text: '偏慢', theme: 'warning' },
  poor: { text: '很慢', theme: 'danger' }
}

/** 量级没有好坏：用中性/品牌色胶囊，只表达多少 */
const MAGNITUDE_PILL: Record<StatMagnitude, StatPill> = {
  1: { text: '较少', theme: 'default' },
  2: { text: '一般', theme: 'default' },
  3: { text: '较多', theme: 'primary' },
  4: { text: '很多', theme: 'primary' }
}

/** 成功率胶囊：环形指标卡与统计卡共用同一套文案，避免两处措辞漂移 */
export function successPill(rate: number | null): StatPill | null {
  const severity = successSeverity(rate)
  return severity ? SUCCESS_PILL[severity] : null
}

/** 已按一位小数收敛过的数值：整数就不再补 .0（与 formatTokens 的展示口径一致） */
function decimalsOf(value: number): number {
  return Number.isInteger(value) ? 0 : 1
}

export function useUsageCards(stats: UseUsageStatsResult): ComputedRef<UsageCardConfig[]> {
  return computed(() => {
    const totals = stats.overview.value.totals
    const series = stats.overview.value.series
    const rate = stats.successRate.value
    const latencyMs = stats.averageDurationMs.value

    const success = successSeverity(rate)
    const latency = latencySeverity(latencyMs)
    const requestLevel = magnitudeLevel(totals.requestCount, REQUEST_MAGNITUDE_THRESHOLDS)
    const tokenLevel = magnitudeLevel(totals.totalTokens, TOKEN_MAGNITUDE_THRESHOLDS)
    const token = tokenParts(totals.totalTokens)

    return [
      {
        key: 'requests',
        label: '请求数',
        icon: 'chart-bar',
        value: totals.requestCount,
        unit: '次',
        decimalPlaces: 0,
        hasValue: true,
        pill: MAGNITUDE_PILL[requestLevel],
        levelClass: `stat-mag-${requestLevel}`,
        viz: { kind: 'bars', values: series.requestCount },
        footer: `成功 ${totals.successCount} · 失败 ${totals.failCount}`
      },
      {
        key: 'success',
        label: '成功率',
        icon: 'check-circle',
        value: rate ?? 0,
        unit: '%',
        decimalPlaces: 1,
        hasValue: rate !== null,
        pill: successPill(rate),
        levelClass: success ? `stat-${success}` : '',
        // 零请求时不画空进度条：「没有请求」与「成功率 0%」不是一回事
        viz: rate === null ? null : { kind: 'progress', percent: rate },
        footer: `失败 ${totals.failCount} 次`
      },
      {
        key: 'latency',
        label: '平均延迟',
        icon: 'time',
        value: latencyMs === null ? 0 : latencyMs / 1000,
        unit: 's',
        decimalPlaces: 2,
        hasValue: latencyMs !== null,
        pill: latency ? LATENCY_PILL[latency] : null,
        levelClass: latency ? `stat-${latency}` : '',
        // 进度条表达「占差档阈值（5s）的比例」：短而绿 = 快，长而红 = 慢
        viz:
          latencyMs === null
            ? null
            : { kind: 'progress', percent: (latencyMs / LATENCY_LIMIT_MS) * 100 },
        footer: `累计耗时 ${(totals.durationMs / 1000).toFixed(1)}s`
      },
      {
        key: 'tokens',
        label: '总 Tokens',
        icon: 'layers',
        value: token.value,
        unit: token.unit,
        decimalPlaces: decimalsOf(token.value),
        hasValue: true,
        pill: MAGNITUDE_PILL[tokenLevel],
        levelClass: `stat-mag-${tokenLevel}`,
        viz: { kind: 'bars', values: series.totalTokens },
        footer: `缓存占比 ${stats.cacheRatio.value.toFixed(1)}%`
      }
    ]
  })
}
