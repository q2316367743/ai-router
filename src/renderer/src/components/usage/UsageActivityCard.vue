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
      <UsageHeatmap :activity="view" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 活跃度卡：指标明细 + 热力矩阵（矩阵与图例已拆到 UsageHeatmap）。
 *
 * 主窗口展示整年（GitHub 提交图式，今天为最后一格）；compact（托盘窄面板）下
 * 只取最近 12 周，四项指标按切片重算，保证卡内指标与热力图口径一致。
 * 热力图的五档色是「热度」语义，与好坏/量级分档无关，故本卡不给卡片挂 stat-* 类。
 */
import { computed } from 'vue'
import type { UsageActivity } from '@common/types'
import type { DashboardCardContext } from './cardTypes'
import MetricCard from './MetricCard.vue'
import UsageHeatmap from './UsageHeatmap.vue'
import { formatTokens } from '@/utils/format'

const props = defineProps<{ ctx: DashboardCardContext }>()

/** 紧凑模式的窗口天数：12 周 × 7 天，约 13 列，400px 面板内格子仍可读 */
const COMPACT_WINDOW_DAYS = 84

const activity = computed<UsageActivity>(() => props.ctx.stats.overview.value.activity)
const compact = computed(() => props.ctx.compact)

/** 展示口径：compact 且数据满一年时切片最近 84 天，并重算窗口内指标 */
const view = computed<UsageActivity>(() => {
  const current = activity.value
  if (!compact.value || current.cells.length <= COMPACT_WINDOW_DAYS) return current
  const cells = current.cells.slice(-COMPACT_WINDOW_DAYS)
  const first = cells[0]
  if (!first) return current
  let longestStreak = 0
  let currentStreak = 0
  let totalTokens = 0
  for (const cell of cells) {
    totalTokens += cell.totalTokens
    if (cell.requestCount > 0) {
      currentStreak += 1
      longestStreak = Math.max(longestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }
  const dailyAverageTokens = totalTokens / cells.length
  return {
    startDate: first.date,
    days: cells.length,
    cells,
    longestStreak,
    dailyAverageTokens,
    weeklyAverageTokens: dailyAverageTokens * 7,
    totalTokens
  }
})

const windowLabel = computed(() => {
  const { days, startDate } = view.value
  if (!startDate || days === 0) return ''
  return days >= 365 ? '近一年' : `近 ${days} 天`
})

const metrics = computed(() => {
  const a = view.value
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
