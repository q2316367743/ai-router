<template>
  <UsageChartCard
    v-if="option"
    title="模型速度趋势（近七天）"
    :hint="SPEED_HINT"
    :option="option"
  />
</template>

<script lang="ts" setup>
/**
 * 模型速度折线卡（供应商 × 模型分线，单位 token/s）。
 *
 * 数据源是 request_logs（保留 7 天）而非用量聚合表，窗口固定近七天且不随看板维度与筛选变化，
 * 故在本组件内独立取数，不进入 useUsageStats——托盘面板不渲染本组件，也就不会白拉一次。
 */
import { computed, onMounted, ref } from 'vue'
import type { UsageModelSpeed } from '@common/types'
import UsageChartCard from './UsageChartCard.vue'
import { buildModelSpeedOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const SPEED_HINT =
  '近七天按「供应商 · 模型」统计的每日平均输出速度（token/s）。' +
  '速度 = 当日输出 token ÷ 当日总耗时，为端到端口径（含预填充与网络等待）。' +
  '只统计成功请求且上游已返回用量，按窗口内输出 token 量取前 5 条；无有效请求的日期不画点。'

const palette = useChartPalette()
const data = ref<UsageModelSpeed | null>(null)

/** 一条线都没有说明窗口内没有可用数据（上游未返回用量或没有成功请求），整卡不渲染 */
const option = computed(() => {
  const speed = data.value
  if (!speed || speed.lines.length === 0) return null
  return buildModelSpeedOption(palette.value, speed.labels, speed.lines)
})

onMounted(() => {
  void window.preload.usage.modelSpeed().then((next) => {
    data.value = next
  })
})
</script>
