<template>
  <div class="quota-window">
    <div class="quota-window__head">
      <span class="quota-window__title">
        {{ title }}
        <span class="quota-window__remain">{{ remainingText }}% 剩余</span>
      </span>
      <span v-if="resetText" class="quota-window__reset">{{ resetText }}</span>
    </div>
    <div class="quota-bar" role="progressbar" :aria-valuenow="usedPercent" aria-valuemin="0" aria-valuemax="100">
      <span class="quota-bar__fill" :style="{ width: `${usedPercent}%`, background: fillColor }"></span>
      <span v-for="tick in TICKS" :key="tick" class="quota-bar__tick" :style="{ left: `${tick}%` }"></span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { QuotaRateWindow } from '@common/types'

const props = defineProps<{
  title: string
  win: QuotaRateWindow
}>()

/** 刻度位置（百分比）：分段视觉，与 CodexBar 面板一致 */
const TICKS = [25, 50, 75]

const usedPercent = computed(() => Math.min(100, Math.max(0, props.win.usedPercent)))

/** 剩余 = 100 - 已用；整数不带小数，小数保留一位 */
const remainingText = computed(() => {
  const remaining = Math.round((100 - usedPercent.value) * 10) / 10
  return Number.isInteger(remaining) ? String(remaining) : remaining.toFixed(1)
})

const resetText = computed(() => {
  const at = props.win.resetsAt
  if (!at) return ''
  if (at <= Date.now()) return '即将重置'
  return `${countdown(at)}后重置`
})

/** 填充表示「已用」，剩余越少越危险 */
const fillColor = computed(() => {
  const used = usedPercent.value
  if (used >= 90) return 'var(--td-error-color)'
  if (used >= 70) return 'var(--td-warning-color)'
  return 'var(--td-brand-color)'
})

function countdown(target: number): string {
  const totalMinutes = Math.max(1, Math.ceil((target - Date.now()) / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}天${hours}时` : `${days}天`
  if (hours > 0) return minutes > 0 ? `${hours}时${minutes}分` : `${hours}时`
  return `${minutes}分`
}
</script>

<style scoped lang="less">
.quota-window {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--td-text-color-primary);
  }

  &__remain {
    margin-left: 2px;
  }

  &__reset {
    flex: none;
    font-size: 12px;
    color: var(--td-text-color-secondary);
  }
}

.quota-bar {
  position: relative;
  height: 8px;
  border-radius: var(--td-radius-round);
  background: var(--td-bg-color-component);
  overflow: hidden;

  &__fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: var(--td-radius-round);
    transition: width var(--fluent-transition-normal);
  }

  &__tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    margin-left: -1px;
    background: var(--td-bg-color-container);
    opacity: 0.6;
  }
}
</style>
