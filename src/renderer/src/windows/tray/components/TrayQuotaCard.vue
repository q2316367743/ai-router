<template>
  <MetricCard
    :class="model.levelClass"
    :label="item.providerName"
    :icon="model.icon"
    :hint="model.hint"
    :pill-text="model.pill?.text"
    :pill-theme="model.pill?.theme"
    :footer="model.footer"
    :value-size="22"
  >
    <t-statistic
      v-if="model.value"
      :value="model.value.value"
      :prefix="model.value.prefix"
      :unit="model.value.unit"
      :decimal-places="model.value.decimalPlaces"
    />
    <span v-else-if="model.windows.length === 0" class="quota-empty">—</span>

    <!-- 限额型：每个窗口一行（标题 + 剩余% + 带刻度的分段进度条），与余量页同一个行组件 -->
    <template v-if="model.windows.length > 0" #viz>
      <div class="quota-windows">
        <QuotaWindowRow v-for="w in model.windows" :key="w.key" :title="w.title" :win="w.win" />
      </div>
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 托盘额度卡（单个提供商，整行一张）：卡内每个限额窗口各一行进度条（opencode 3 行、zai 3 行…）。
 *
 * - 窗口行复用 `components/quota/QuotaWindowRow.vue`（与主窗口余量页同一个组件，含 25/50/75 刻度
 *   与重置倒计时），进度条按各自窗口的剩余分档上色 —— 「不同百分比不同颜色」就在这里逐条体现；
 * - 卡片根节点的分档类按**最紧张的窗口**取（余额型则按余额阈值取），只负责右上角同色渐晕，
 *   让「某一个窗口告急 / 余额见底」时整卡一眼可辨；
 * - 只有余额、没有可比比例的策略（DeepSeek 等）退化为大数值卡；完整明细仍在主窗口「余量」页。
 */
import { computed } from 'vue'
import type { ProviderQuotaInfo, QuotaRateWindow } from '@common/types'
import {
  balanceSeverity,
  currencyPrefix,
  quotaWindowSeverity,
  windowTitleOf
} from '@common/utils/quotaDisplay'
import MetricCard from '@/components/usage/MetricCard.vue'
import QuotaWindowRow from '@/components/quota/QuotaWindowRow.vue'
import { relativeTime } from '@/utils/format'

const props = defineProps<{
  item: ProviderQuotaInfo
  /** 余额告警阈值（来自托盘额度配置） */
  threshold: number
}>()

type PillTheme = 'default' | 'primary' | 'warning' | 'danger' | 'success'

/** 卡内大数值（只有「无可比比例」的余额型才用） */
interface QuotaCardValue {
  value: number
  /** 货币符号前缀 */
  prefix: string
  unit: string
  decimalPlaces: number
}

interface QuotaCardModel {
  /** tdesign 图标名（不手写 SVG） */
  icon: string
  pill: { text: string; theme: PillTheme } | null
  /** 分档类：决定卡片右上角渐晕，空串表示不分档 */
  levelClass: string
  /** 限额型：卡内逐行进度条；其余形态为空数组 */
  windows: WindowRow[]
  value: QuotaCardValue | null
  footer: string
  hint: string
}

interface WindowRow {
  key: string
  title: string
  win: QuotaRateWindow
}

/** 主/次/第三 + 具名附加窗口，扁平成卡内行 */
function windowRowsOf(item: ProviderQuotaInfo): WindowRow[] {
  const snap = item.snapshot
  if (!snap) return []
  const rows: WindowRow[] = []
  const push = (fallback: string, key: string, win: QuotaRateWindow | null | undefined): void => {
    if (win) rows.push({ key, title: windowTitleOf(fallback, win), win })
  }
  push('主窗口', 'primary', snap.primary)
  push('次窗口', 'secondary', snap.secondary)
  push('第三窗口', 'tertiary', snap.tertiary)
  for (const extra of snap.extraWindows ?? []) {
    rows.push({
      key: extra.id,
      title: extra.title || windowTitleOf('附加窗口', extra.window),
      win: extra.window
    })
  }
  return rows
}

/** 最紧张的窗口（剩余最少 = 最该被看见的那一个），用于整卡渐晕 */
function mostCritical(windows: WindowRow[]): WindowRow | null {
  let critical: WindowRow | null = null
  for (const row of windows) {
    if (!critical || row.win.usedPercent > critical.win.usedPercent) critical = row
  }
  return critical
}

/** 失败原因在窄卡里只留摘要，复读全文交给提示气泡 */
function errorBrief(error: string): string {
  return error.length > 42 ? `${error.slice(0, 42)}…` : error
}

/** 提示气泡：策略来源 + 该条的更新时间（面板顶部的「更新于」是全部卡片里最保守的汇总） */
function hintOf(item: ProviderQuotaInfo): string {
  const parts: string[] = []
  if (item.strategyLabel) parts.push(`策略 ${item.strategyLabel}`)
  if (item.error) parts.push(item.error)
  else if (item.queriedAt) parts.push(`${relativeTime(item.queriedAt)}更新`)
  return parts.join(' · ')
}

const model = computed<QuotaCardModel>(() => {
  const item = props.item
  const hint = hintOf(item)
  const snap = item.snapshot

  if (!snap) {
    return {
      icon: 'wallet',
      pill: item.error ? { text: '查询失败', theme: 'danger' } : null,
      levelClass: item.error ? 'stat-poor' : '',
      windows: [],
      value: null,
      footer: item.error ? errorBrief(item.error) : '等待首次查询',
      hint
    }
  }

  const cost = snap.cost
  const plan = snap.identity?.loginMethod ?? ''
  const windows = windowRowsOf(item)
  if (windows.length > 0) {
    const critical = mostCritical(windows)
    const balanceText =
      cost?.balance != null ? `余额 ${currencyPrefix(cost.currency)}${cost.balance}` : ''
    return {
      icon: 'chart-ring',
      pill: null,
      levelClass: critical ? `stat-${quotaWindowSeverity(critical.win.usedPercent)}` : '',
      windows,
      value: null,
      footer: [balanceText, plan].filter(Boolean).join(' · '),
      hint
    }
  }

  // 花费型带限额（可算比例）：与窗口同形——一条进度条 + 页脚写金额
  if (cost?.limit != null) {
    const costPercent = cost.limit > 0 ? (cost.used / cost.limit) * 100 : 0
    const prefix = currencyPrefix(cost.currency)
    const row: WindowRow = {
      key: 'cost',
      title: cost.period || '限额',
      win: { usedPercent: costPercent, resetsAt: cost.resetsAt ?? null }
    }
    return {
      icon: 'chart-ring',
      pill: null,
      levelClass: `stat-${quotaWindowSeverity(costPercent)}`,
      windows: [row],
      value: null,
      footer: [`已用 ${prefix}${cost.used} / 限额 ${prefix}${cost.limit}`, plan]
        .filter(Boolean)
        .join(' · '),
      hint
    }
  }

  // 纯余额型（DeepSeek 等）：没有上限可比，呈现为大数值 + 阈值分档
  if (cost?.balance != null) {
    return {
      icon: 'wallet',
      pill: { text: '余额', theme: 'default' },
      levelClass: `stat-${balanceSeverity(cost.balance, props.threshold)}`,
      windows: [],
      value: {
        value: cost.balance,
        prefix: currencyPrefix(cost.currency),
        unit: '',
        decimalPlaces: 2
      },
      footer: plan,
      hint
    }
  }

  // 只给明细分区的策略：主数值无从归一，退化为占位符 + 首两行明细
  const detailText = (snap.details?.[0]?.rows ?? [])
    .slice(0, 2)
    .map((row) => `${row.label} ${row.value}`)
    .join(' · ')
  return {
    icon: 'wallet',
    pill: null,
    levelClass: '',
    windows: [],
    value: null,
    footer: [detailText, plan].filter(Boolean).join(' · '),
    hint
  }
})
</script>

<style scoped lang="less">
.quota-windows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quota-empty {
  font-size: var(--metric-value-size, 26px);
  font-weight: 600;
  line-height: 1.2;
  color: var(--td-text-color-placeholder);
}
</style>
