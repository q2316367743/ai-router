<template>
  <MetricCard label="活跃度" icon="calendar" :pill-text="windowLabel">
    <!-- 四项指标按参考图的多行明细排布：值在上、标签在下，2×2 网格 -->
    <div class="metric-grid">
      <div v-for="metric in metrics" :key="metric.label" class="metric-cell">
        <div class="metric-cell-value">{{ metric.value }}</div>
        <div class="metric-cell-label">{{ metric.label }}</div>
      </div>
    </div>

    <template #viz>
      <UsageHeatmap :activity="activity" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 活跃度卡：指标明细 + 热力矩阵（矩阵与图例已拆到 UsageHeatmap）。
 *
 * 四项指标与热力图同窗口口径；窗口文案挂在卡片头部的胶囊上（对应参考图的「日/周/月」位）。
 * 热力图的五档色是「热度」语义，与好坏/量级分档无关，故本卡不给卡片挂 stat-* 类。
 */
import { computed } from 'vue'
import type { UsageActivity } from '@common/types'
import MetricCard from './MetricCard.vue'
import UsageHeatmap from './UsageHeatmap.vue'
import { formatTokens } from '@/utils/format'

const props = defineProps<{ activity: UsageActivity }>()

const windowLabel = computed(() => {
  const { days, startDate } = props.activity
  if (!startDate || days === 0) return ''
  return `近 ${days} 天`
})

const metrics = computed(() => {
  const a = props.activity
  return [
    { label: '最长连续', value: `${a.longestStreak} 天` },
    { label: '日均 Tokens', value: formatTokens(Math.round(a.dailyAverageTokens)) },
    { label: '周均 Tokens', value: formatTokens(Math.round(a.weeklyAverageTokens)) },
    { label: '总计 Tokens', value: formatTokens(a.totalTokens) }
  ]
})
</script>

<style scoped lang="less">
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.metric-cell-value {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--td-text-color-primary);
  white-space: nowrap;
}

.metric-cell-label {
  margin-top: 1px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
}
</style>
