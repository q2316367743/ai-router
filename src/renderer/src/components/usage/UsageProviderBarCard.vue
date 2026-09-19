<template>
  <UsageChartCard
    v-if="option"
    title="供应商 Tokens"
    icon="chart-bar"
    :option="option"
    :height="height"
  />
</template>

<script lang="ts" setup>
/**
 * 供应商 Tokens 条形图卡：取 token 前 6 名，其余合并为「其他」；无数据时整卡不渲染。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import UsageChartCard from './UsageChartCard.vue'
import { buildTopBarOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

const option = computed(() => {
  const providers = props.ctx.stats.overview.value.providers.filter((item) => item.totalTokens > 0)
  if (providers.length === 0) return null
  const top = providers.slice(0, 6)
  const rest = providers.slice(6)
  const names = top.map((item) => item.key)
  const values = top.map((item) => item.totalTokens)
  if (rest.length > 0) {
    names.push('其他')
    values.push(rest.reduce((acc, item) => acc + item.totalTokens, 0))
  }
  return buildTopBarOption(palette.value, names, values)
})

const height = computed(() => {
  const count = props.ctx.stats.overview.value.providers.length
  return Math.max(120, Math.min(count + 1, 7) * 28 + 24)
})
</script>
