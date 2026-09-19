<template>
  <div class="detail-chart">
    <div v-if="chart.unit" class="detail-chart__unit">{{ chart.unit }}</div>
    <div class="detail-chart__bars">
      <span
        v-for="(point, index) in chart.points"
        :key="index"
        class="detail-chart__bar"
        :style="{ height: `${percents[index]}%` }"
        :title="`${point.label}: ${point.value}`"
      ></span>
    </div>
    <div v-if="chart.points.length >= 2" class="detail-chart__axis">
      <span>{{ chart.points[0].label }}</span>
      <span>{{ chart.points[chart.points.length - 1].label }}</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { QuotaDetailChart } from '@common/types'

const props = defineProps<{ chart: QuotaDetailChart }>()

/** 非零值最小可见高度：避免极小柱被压成不可见 */
const MIN_VISIBLE_PERCENT = 6

/** 按最大值归一；全 0 时压平（不画假柱子） */
const percents = computed(() => {
  const max = props.chart.points.reduce((acc, point) => Math.max(acc, point.value), 0)
  if (max <= 0) return props.chart.points.map(() => 0)
  return props.chart.points.map((point) =>
    point.value <= 0 ? 0 : Math.max(MIN_VISIBLE_PERCENT, (point.value / max) * 100)
  )
})
</script>

<style scoped lang="less">
.detail-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;

  &__unit {
    font-size: 11px;
    color: var(--td-text-color-placeholder);
    text-align: right;
  }

  &__bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 56px;
  }

  &__bar {
    flex: 1;
    min-width: 0;
    border-radius: 2px;
    background: var(--td-brand-color);
    opacity: 0.85;
    transition: height var(--fluent-transition-normal);
  }

  &__axis {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--td-text-color-placeholder);
  }
}
</style>
