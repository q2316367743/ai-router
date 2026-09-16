<template>
  <div class="chart-card">
    <div class="chart-title">{{ title }}</div>
    <EChart :option="option" :height="height" />
  </div>
</template>

<script lang="ts" setup>
/**
 * 通用图表卡：组合图 / 供应商条形图共用外壳（标题 + echarts 容器）。
 */
import EChart from '@/components/EChart/EChart.vue'
import type { EChartsOption } from '@/components/EChart/echarts'

withDefaults(defineProps<{ title: string; option: EChartsOption; height?: number }>(), {
  height: 240
})
</script>

<style scoped lang="less">
.chart-card {
  padding: 12px 14px 4px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.chart-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}
</style>
