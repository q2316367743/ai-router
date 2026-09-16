<template>
  <div class="chart-card">
    <div class="chart-head">
      <div class="chart-title">{{ title }}</div>
      <t-tooltip v-if="hint" :content="hint" placement="top-right">
        <t-icon name="help-circle" class="chart-hint" />
      </t-tooltip>
    </div>
    <EChart :option="option" :height="height" />
  </div>
</template>

<script lang="ts" setup>
/**
 * 通用图表卡：组合图 / 供应商条形图 / 模型速度折线共用外壳（标题 + 可选口径说明 + echarts 容器）。
 */
import EChart from '@/components/EChart/EChart.vue'
import type { EChartsOption } from '@/components/EChart/echarts'

withDefaults(
  defineProps<{ title: string; option: EChartsOption; height?: number; hint?: string }>(),
  {
    height: 240,
    hint: ''
  }
)
</script>

<style scoped lang="less">
.chart-card {
  padding: 12px 14px 4px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.chart-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.chart-title {
  font-size: 13px;
  font-weight: 500;
}

.chart-hint {
  font-size: 14px;
  color: var(--td-text-color-placeholder);
  cursor: help;
}
</style>
