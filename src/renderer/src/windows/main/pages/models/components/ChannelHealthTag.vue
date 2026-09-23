<template>
  <t-tooltip placement="top" :disabled="!hasDetail">
    <t-tag :theme="theme" variant="light" size="small"> 可用度 {{ availabilityText }} </t-tag>
    <template #content>
      <div class="health-detail">
        <div>状态：{{ label }}</div>
        <div v-if="blocked">
          额度阻断：{{ info?.blockReason }}（{{ blockUntilText(info?.blockUntil ?? null) }}）
        </div>
        <div v-if="info?.lastError">最近失败：{{ info.lastError }}</div>
        <div v-if="info?.lastFailureAt">失败时间：{{ formatTime(info.lastFailureAt) }}</div>
        <div v-if="info?.lastSuccessAt">最近成功：{{ formatTime(info.lastSuccessAt) }}</div>
        <div v-if="info?.consecutiveFailures">连续失败：{{ info.consecutiveFailures }} 次</div>
      </div>
    </template>
  </t-tooltip>
</template>

<script lang="ts" setup>
import type { ChannelHealthInfo } from '@common/types'
import {
  CHANNEL_STATE_LABEL,
  blockUntilText,
  formatAvailability
} from '@common/utils/balancerDisplay'
import { formatTime } from '@/utils/format'

/**
 * 渠道健康徽标：可用度数值 + 悬浮明细。
 *
 * 可用度即该渠道当前的流量权重（0 = 额度阻断不给流量），详情里给出最近失败原因与
 * 阻断解除时刻，用于回答「为什么流量跑到另一家去了」。
 */
const props = defineProps<{
  /** 未查到记录（从未失败过）时为 null，按满值正常展示 */
  info: ChannelHealthInfo | null
}>()

const availability = computed(() => props.info?.availability ?? 100)
const blocked = computed(() => props.info?.state === 'blocked')
const availabilityText = computed(() => formatAvailability(availability.value))
const label = computed(() =>
  props.info ? CHANNEL_STATE_LABEL[props.info.state] : CHANNEL_STATE_LABEL.healthy
)

/** 分档 → 徽标色（与余额/余量卡的分档口径同构：好=success、中=warning、差=danger） */
const theme = computed<'success' | 'warning' | 'danger'>(() => {
  if (blocked.value) return 'danger'
  return availability.value >= 100 ? 'success' : 'warning'
})

const hasDetail = computed(
  () => !!props.info && (blocked.value || !!props.info.lastError || availability.value < 100)
)
</script>

<style scoped lang="less">
.health-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 320px;
  font-size: 12px;
  line-height: 1.6;
}
</style>
