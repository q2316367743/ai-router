<template>
  <UsageChartCard
    v-if="option"
    title="供应商 Tokens 趋势"
    icon="chart-line"
    :option="option"
    :height="height"
  />
</template>

<script lang="ts" setup>
/**
 * 供应商 Tokens 趋势卡：按供应商分线的 token 折线。
 * 仅小时粒度（今天 / 近 24 小时）展示，日粒度下折线过密；无数据时整卡不渲染。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import UsageChartCard from './UsageChartCard.vue'
import { buildProviderTrendOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

const option = computed(() => {
  const series = props.ctx.stats.overview.value.series
  if (series.granularity !== 'hour') return null
  const lines = series.byProviderTokens.filter((line) => line.data.some((value) => value > 0))
  if (lines.length === 0) return null
  return buildProviderTrendOption(palette.value, series.labels, lines)
})

const height = computed(() => (props.ctx.compact ? 160 : 220))
</script>
