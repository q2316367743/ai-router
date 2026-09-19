<template>
  <MetricCard label="缓存占比" icon="chart-ring" :footer="footer">
    <template #viz>
      <EChart :option="option" :height="140" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 缓存占比环形卡：缓存 vs 非缓存两段环形，中心显示主占比。
 * 缓存占比没有好坏阈值，因此不给胶囊、不挂分档色。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import EChart from '@/components/EChart/EChart.vue'
import { buildRatioDonutOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'
import MetricCard from './MetricCard.vue'
import { formatTokens } from '@/utils/format'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

const totals = computed(() => props.ctx.stats.overview.value.totals)
const cacheTokens = computed(() => props.ctx.stats.cacheTokens.value)

const otherTokens = computed(() => Math.max(0, totals.value.totalTokens - cacheTokens.value))

const footer = computed(
  () => `缓存 ${formatTokens(cacheTokens.value)} · 非缓存 ${formatTokens(otherTokens.value)}`
)

const option = computed(() =>
  buildRatioDonutOption(
    palette.value,
    '缓存',
    cacheTokens.value,
    '非缓存',
    otherTokens.value,
    palette.value.warning
  )
)
</script>
