<template>
  <div class="mini-progress" :style="{ height: `${height}px` }">
    <span class="mini-progress__fill" :style="{ width: `${filled}%` }"></span>
  </div>
</template>

<script lang="ts" setup>
/**
 * 卡内迷你进度条：把比例画成一条细槽。
 * 颜色走 currentColor 继承卡片的分档色，与 MiniBars 同一约定。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 填充比例（0–100），超出范围会被夹紧 */
    percent: number
    height?: number
  }>(),
  { height: 6 }
)

const filled = computed(() => Math.min(100, Math.max(0, props.percent)))
</script>

<style scoped lang="less">
.mini-progress {
  width: 100%;
  border-radius: var(--td-radius-round);
  background: var(--td-bg-color-component);
  overflow: hidden;
}

.mini-progress__fill {
  display: block;
  height: 100%;
  border-radius: var(--td-radius-round);
  background: currentColor;
  transition: width var(--fluent-transition-normal);
}
</style>
