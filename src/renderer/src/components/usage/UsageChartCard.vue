<template>
  <MetricCard :label="title" :icon="icon" :hint="hint" :footer="footer">
    <template #viz>
      <EChart :option="option" :height="height" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 通用图表卡：组合图 / 供应商条形图 / 模型速度折线共用外壳。
 *
 * 图表是卡片的主内容而非「迷你图」，但仍走 viz 插槽，保证与统计卡同一套头部节奏
 * （图标 + 标题 + 口径说明）。本卡没有大数值段：图表卡不编造头条数字。
 */
import type { Component } from 'vue'
import EChart from '@/components/EChart/EChart.vue'
import type { EChartsOption } from '@/components/EChart/echarts'
import MetricCard from './MetricCard.vue'

withDefaults(
  defineProps<{
    title: string
    option: EChartsOption
    height?: number
    /** 口径说明，附在标题旁的问号图标上 */
    hint?: string
    /** 图标组件（tdesign-icons-vue-next 直接引入） */
    icon?: Component
    footer?: string
  }>(),
  { height: 240, hint: '', footer: '' }
)
</script>
