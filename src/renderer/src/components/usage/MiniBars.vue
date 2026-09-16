<template>
  <div class="mini-bars" :style="{ height: `${height}px` }">
    <span
      v-for="(bar, index) in bars"
      :key="index"
      class="mini-bar"
      :style="{ height: `${bar.percent}%` }"
    ></span>
  </div>
</template>

<script lang="ts" setup>
/**
 * 卡内迷你柱图：把逐桶数值画成等高归一化的细柱。
 *
 * 只表达「形状」—— 不画坐标轴与刻度（卡内放不下），具体数值由同卡的 t-statistic 承担。
 * 颜色一律走 currentColor，由所在卡片继承分档色（stat-good / stat-mag-2 等），
 * 因此本组件不需要色值表。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 逐桶数值（如 series.requestCount），按最大值归一 */
    values: number[]
    height?: number
  }>(),
  { height: 28 }
)

/** 非零值的最小可见高度：否则极小值会被压成看不见的线，被误读为「无数据」 */
const MIN_VISIBLE_PERCENT = 8

const bars = computed(() => {
  const max = props.values.reduce((acc, value) => Math.max(acc, value), 0)
  // 全 0 时全部压平：空着一片比画一排假柱子诚实
  if (max <= 0) return props.values.map(() => ({ percent: 0 }))
  return props.values.map((value) => ({
    percent: value <= 0 ? 0 : Math.max(MIN_VISIBLE_PERCENT, (value / max) * 100)
  }))
})
</script>

<style scoped lang="less">
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.mini-bar {
  flex: 1;
  min-width: 0;
  border-radius: 2px;
  background: currentColor;
  transition: height var(--fluent-transition-normal);
}
</style>
