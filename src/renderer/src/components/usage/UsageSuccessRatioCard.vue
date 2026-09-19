<template>
  <MetricCard
    :class="levelClass"
    label="成功率"
    icon="chart-ring"
    :pill-text="pill?.text"
    :pill-theme="pill?.theme"
    :footer="footer"
  >
    <template #viz>
      <EChart :option="option" :height="140" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 成功率环形卡：成功 vs 失败两段环形，中心显示主占比。
 * 复用统计卡同一套胶囊文案与分档色（阈值来自 useUsageStats，不在此重复定义）。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import EChart from '@/components/EChart/EChart.vue'
import { buildRatioDonutOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'
import MetricCard from './MetricCard.vue'
import { successPill } from './useUsageCards'
import { successSeverity } from './useUsageStats'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

const totals = computed(() => props.ctx.stats.overview.value.totals)

const successRate = computed(() =>
  totals.value.requestCount > 0 ? (totals.value.successCount / totals.value.requestCount) * 100 : null
)

const pill = computed(() => successPill(successRate.value))

/** 分档色类：环形卡的渐晕与统计卡同源 */
const levelClass = computed(() => {
  const severity = successSeverity(successRate.value)
  return severity ? `stat-${severity}` : ''
})

const footer = computed(() => `成功 ${totals.value.successCount} · 失败 ${totals.value.failCount}`)

const option = computed(() =>
  buildRatioDonutOption(
    palette.value,
    '成功',
    totals.value.successCount,
    '失败',
    totals.value.failCount,
    palette.value.success
  )
)
</script>
