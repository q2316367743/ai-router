<template>
  <div class="quota-card" :class="{ 'opacity-60': item.enabled === false }">
    <div class="quota-card__header">
      <div class="quota-card__name-row">
        <span class="quota-card__name" :title="item.providerName">{{ item.providerName }}</span>
        <t-tag variant="outline" size="small">{{ item.strategyLabel }}</t-tag>
        <t-tag v-if="item.enabled === false" theme="warning" variant="light" size="small">已停用</t-tag>
        <t-button
          class="quota-card__refresh"
          variant="text"
          shape="square"
          size="small"
          :loading="refreshing"
          title="刷新该提供商"
          @click="emit('refresh', item.providerId)"
        >
          <template #icon><t-icon name="refresh" /></template>
        </t-button>
      </div>
      <div class="quota-card__meta">
        <span>{{ updatedText }}</span>
        <span v-if="summaryText" class="quota-card__summary" :title="summaryText">{{ summaryText }}</span>
      </div>
    </div>

    <t-alert v-if="item.error" theme="error" class="mt-8px">
      <span class="text-12px">{{ item.error }}</span>
    </t-alert>

    <template v-if="snapshot">
      <div v-if="windows.length" class="quota-card__windows">
        <QuotaWindowRow v-for="w in windows" :key="w.key" :title="w.title" :win="w.win" />
      </div>

      <div v-for="section in snapshot.details ?? []" :key="section.title" class="quota-card__section">
        <div class="quota-card__section-title">{{ section.title }}</div>
        <div v-for="row in section.rows" :key="row.label" class="quota-card__row">
          <span class="quota-card__row-label">{{ row.label }}</span>
          <span class="quota-card__row-value">
            <span>{{ row.value }}</span>
            <span v-if="row.secondaryValue" class="quota-card__row-secondary">{{ row.secondaryValue }}</span>
          </span>
        </div>
        <QuotaDetailChart v-if="section.chart" :chart="section.chart" />
      </div>

      <div v-if="identityText" class="quota-card__identity" :title="identityText">{{ identityText }}</div>
    </template>

    <div v-else-if="!item.error" class="quota-card__placeholder">
      <template v-if="refreshing"><t-loading size="small" text="查询中…" loading /></template>
      <span v-else-if="item.enabled === false">提供商已停用，不参与余量查询</span>
      <span v-else>等待首次查询（页面打开时会自动补查）</span>
    </div>

    <div class="quota-card__footer">
      <span v-if="item.queriedAt">查询于 {{ formatTime(item.queriedAt) }}</span>
      <span v-else>等待首次查询</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ProviderQuotaInfo, QuotaCostSnapshot, QuotaRateWindow } from '@common/types'
import { formatTime } from '@/utils/format'
import QuotaDetailChart from './QuotaDetailChart.vue'
import QuotaWindowRow from './QuotaWindowRow.vue'

const props = defineProps<{
  item: ProviderQuotaInfo
  refreshing: boolean
}>()

const emit = defineEmits<{
  refresh: [providerId: string]
}>()

const snapshot = computed(() => props.item.snapshot)

interface CardWindow {
  key: string
  title: string
  win: QuotaRateWindow
}

/** 主/次/第三 + 具名附加窗口，扁平成面板行 */
const windows = computed<CardWindow[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const rows: CardWindow[] = []
  const push = (fallback: string, key: string, win: QuotaRateWindow | null | undefined): void => {
    if (win) rows.push({ key, title: windowTitle(fallback, win), win })
  }
  push('主窗口', 'primary', snap.primary)
  push('次窗口', 'secondary', snap.secondary)
  push('第三窗口', 'tertiary', snap.tertiary)
  for (const extra of snap.extraWindows ?? []) {
    rows.push({ key: extra.id, title: extra.title || windowTitle('附加窗口', extra.window), win: extra.window })
  }
  return rows
})

/** 窗口标题按 windowMinutes 归一（5 小时 / 每周 / 每月），否则回退策略说明或序号名 */
function windowTitle(fallback: string, win: QuotaRateWindow): string {
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

const updatedText = computed(() =>
  props.item.queriedAt ? `${relativeTime(props.item.queriedAt)}已更新` : '等待首次查询'
)

/** 右上摘要：优先花费（$used / $limit），无则套餐名 */
const summaryText = computed(() => {
  const snap = snapshot.value
  if (!snap) return ''
  const cost = snap.cost ? costSummaryOf(snap.cost) : ''
  return cost || snap.identity?.loginMethod || ''
})

/** 账号标识行（套餐名已用于右上摘要，此处只留账号信息） */
const identityText = computed(() => {
  const identity = snapshot.value?.identity
  if (!identity) return ''
  return [identity.email, identity.organization, identity.accountID].filter(Boolean).join(' · ')
})

function currencyPrefix(currency: string): string {
  const code = currency.toUpperCase()
  if (code === 'USD') return '$'
  if (code === 'CNY' || code === 'RMB') return '¥'
  return currency ? `${currency} ` : ''
}

function costSummaryOf(cost: QuotaCostSnapshot): string {
  const prefix = currencyPrefix(cost.currency)
  // 余额优先：DeepSeek 这类账户余额型会带 used=0（0 也是「有值」），不能用 != null 判断
  if (cost.balance != null) return `余额 ${prefix}${cost.balance}`
  if (cost.limit != null) return `${prefix}${cost.used} / ${prefix}${cost.limit}`
  if (cost.used) return `${prefix}${cost.used}`
  return ''
}

function relativeTime(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}
</script>

<style scoped lang="less">
.quota-card {
  display: flex;
  flex-direction: column;
  width: 400px;
  box-sizing: border-box;
  padding: 16px;
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--td-component-stroke);
  box-shadow: var(--td-shadow-1);

  &__header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  &__name {
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__refresh {
    flex: none;
    margin-left: auto;
  }

  &__meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: var(--td-text-color-secondary);
  }

  &__summary {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__windows {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
  }

  &__section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--td-component-stroke);
  }

  &__section-title {
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--td-text-color-secondary);
  }

  &__row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    line-height: 20px;
  }

  &__row-label {
    color: var(--td-text-color-secondary);
  }

  &__row-value {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }

  &__row-secondary {
    color: var(--td-text-color-secondary);
  }

  &__identity {
    margin-top: 12px;
    overflow: hidden;
    font-size: 12px;
    color: var(--td-text-color-placeholder);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__placeholder {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    font-size: 13px;
    color: var(--td-text-color-secondary);
  }

  &__footer {
    margin-top: auto;
    padding-top: 12px;
    font-size: 12px;
    color: var(--td-text-color-placeholder);
  }
}
</style>
