<template>
  <UsageChartCard title="请求与用量趋势" icon="chart-combo" :option="option" :height="height" />
</template>

<script lang="ts" setup>
/**
 * 请求与用量趋势卡：柱状（请求数）+ 折线（总 token / 缓存 token）。
 * 自给自足卡片：从 ctx 取数并构建图表 option，随看板维度与筛选联动。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import UsageChartCard from './UsageChartCard.vue'
import { buildRequestTokenOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

const option = computed(() => {
  const series = props.ctx.stats.overview.value.series
  return buildRequestTokenOption(
    palette.value,
    series.labels,
    series.requestCount,
    series.totalTokens,
    series.cacheTokens
  )
})

const height = computed(() => (props.ctx.compact ? 180 : 240))
</script>
