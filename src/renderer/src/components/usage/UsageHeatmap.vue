<template>
  <EChart v-if="option" :option="option" :height="height" />
</template>

<script lang="ts" setup>
/**
 * 活跃度热力矩阵：echarts 日历热力图（列=周、行=星期、带月/日标签与 visualMap 色阶）。
 *
 * 排布与 tooltip 由 `buildCalendarHeatmapOption` 纯函数构造；本组件只负责取 palette、
 * 按 compact 决定格子高度与整图高度。数据窗口（首页整年 / 托盘 12 周）由父组件切片后传入。
 */
import { computed } from 'vue'
import type { UsageActivity } from '@common/types'
import type { EChartsOption } from '@/components/EChart/echarts'
import EChart from '@/components/EChart/EChart.vue'
import { buildCalendarHeatmapOption } from '@/components/EChart/optionsFlow'
import { useChartPalette } from '@/components/EChart/tokens'

const props = withDefaults(
  defineProps<{
    activity: UsageActivity
    /** 紧凑模式（托盘窄面板）：压矮格子与整图 */
    compact?: boolean
  }>(),
  { compact: false }
)

const palette = useChartPalette()

const option = computed<EChartsOption | null>(() =>
  buildCalendarHeatmapOption(palette.value, props.activity, props.compact ? 10 : 12)
)

const height = computed(() => (props.compact ? 190 : 230))
</script>
