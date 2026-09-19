<template>
  <div class="quota-card" :class="{ 'opacity-60': item.enabled === false }">
    <div class="quota-card__header">
      <div class="flex min-w-0 items-center gap-8px">
        <span class="truncate text-15px font-600" :title="item.providerName">{{ item.providerName }}</span>
        <t-tag variant="outline" size="small">{{ item.strategyLabel }}</t-tag>
        <t-tag v-if="item.enabled === false" theme="warning" variant="light" size="small">已停用</t-tag>
      </div>
      <t-button
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

    <t-alert v-if="item.error" theme="error" class="mt-8px">
      <span class="text-12px">{{ item.error }}</span>
    </t-alert>

    <template v-if="snapshot">
      <div class="mt-12px flex flex-col gap-12px">
        <div v-for="win in visibleWindows" :key="win.label">
          <div class="mb-4px flex items-center justify-between text-12px">
            <span class="text-td-secondary">{{ win.label }}</span>
            <span class="text-td-secondary">{{ win.resetText }}</span>
          </div>
          <t-progress
            :percentage="win.usedPercent"
            :color="progressColor(win.usedPercent)"
            :stroke-width="8"
            :label="`${win.usedPercent.toFixed(0)}%`"
          />
        </div>
      </div>

      <div v-if="costText" class="mt-12px flex items-center gap-6px text-13px">
        <t-icon name="wallet" class="text-td-secondary" />
        <span>{{ costText }}</span>
      </div>

      <div v-for="section in snapshot.details ?? []" :key="section.title" class="mt-12px">
        <div class="mb-4px text-12px text-td-secondary">{{ section.title }}</div>
        <div v-for="row in section.rows" :key="row.label" class="flex justify-between text-12px leading-20px">
          <span class="text-td-secondary">{{ row.label }}</span>
          <span class="text-right">
            {{ row.value }}
            <span v-if="row.secondaryValue" class="text-td-secondary">（{{ row.secondaryValue }}）</span>
          </span>
        </div>
      </div>

      <div v-if="identityText" class="mt-12px truncate text-12px text-td-secondary" :title="identityText">
        {{ identityText }}
      </div>
    </template>

    <div v-else-if="!item.error" class="mt-16px flex items-center gap-8px text-13px text-td-secondary">
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
import type { ProviderQuotaInfo, QuotaRateWindow } from '@common/types'

const props = defineProps<{
  item: ProviderQuotaInfo
  refreshing: boolean
}>()

const emit = defineEmits<{
  refresh: [providerId: string]
}>()

const snapshot = computed(() => props.item.snapshot)

interface CardWindow {
  label: string
  win: QuotaRateWindow
  usedPercent: number
  resetText: string
}

/** 主/次/第三 + 具名附加窗口，扁平成卡片行 */
const visibleWindows = computed<CardWindow[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const rows: CardWindow[] = []
  const push = (label: string, win: QuotaRateWindow | null | undefined): void => {
    if (!win) return
    rows.push({ label, win, usedPercent: win.usedPercent, resetText: resetTextOf(win) })
  }
  push('主窗口', snap.primary)
  push('次窗口', snap.secondary)
  push('第三窗口', snap.tertiary)
  for (const extra of snap.extraWindows ?? []) push(extra.title, extra.window)
  return rows
})

/** 重置说明 + 剩余倒计时（resetsAt 在未来才显示倒计时） */
function resetTextOf(win: QuotaRateWindow): string {
  const parts: string[] = []
  if (win.resetDescription) parts.push(win.resetDescription)
  if (win.resetsAt && win.resetsAt > Date.now()) parts.push(`${countdown(win.resetsAt)}后重置`)
  else if (win.resetsAt && win.resetsAt <= Date.now()) parts.push('即将重置')
  return parts.join(' · ')
}

function countdown(target: number): string {
  const totalMinutes = Math.max(1, Math.ceil((target - Date.now()) / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}天${hours}时` : `${days}天`
  if (hours > 0) return minutes > 0 ? `${hours}时${minutes}分` : `${hours}时`
  return `${minutes}分`
}

const costText = computed(() => {
  const cost = snapshot.value?.cost
  if (!cost) return ''
  const parts: string[] = []
  if (cost.balance != null) parts.push(`余额 ${cost.balance}`)
  if (cost.used) parts.push(`已用 ${cost.used}`)
  if (cost.limit != null) parts.push(`上限 ${cost.limit}`)
  return parts.length ? `${parts.join(' · ')} ${cost.currency}（${cost.period ?? '余额'}）` : ''
})

const identityText = computed(() => {
  const identity = snapshot.value?.identity
  if (!identity) return ''
  return [identity.loginMethod, identity.organization, identity.email].filter(Boolean).join(' · ')
})

function progressColor(percent: number): string {
  if (percent >= 90) return 'var(--td-error-color)'
  if (percent >= 70) return 'var(--td-warning-color)'
  return 'var(--td-brand-color)'
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
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
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__footer {
    margin-top: auto;
    padding-top: 12px;
    font-size: 12px;
    color: var(--td-text-color-placeholder);
  }
}
</style>
