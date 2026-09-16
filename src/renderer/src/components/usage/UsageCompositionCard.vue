<template>
  <div class="composition-card">
    <div class="flex items-center justify-between mb-10px">
      <span class="text-13px font-500">令牌构成</span>
      <span class="text-11px text-td-placeholder">条宽以最大值为 100%</span>
    </div>

    <div v-if="segments.length === 0" class="text-12px text-td-placeholder py-8px">
      所选区间内暂无用量
    </div>

    <div v-else class="flex flex-col gap-8px">
      <div v-for="segment in segments" :key="segment.name">
        <div class="flex items-center justify-between mb-4px">
          <span class="text-12px text-td-secondary">{{ segment.name }}</span>
          <span class="text-12px">
            {{ formatTokens(segment.value) }}
            <span class="text-td-placeholder">· {{ segment.percent.toFixed(1) }}%</span>
          </span>
        </div>
        <div class="bar-track">
          <div
            class="bar-fill"
            :style="{ width: `${segment.barPercent}%`, background: colorOf(segment.tone) }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 令牌构成：输入 / 输出 / 缓存 / 无法统计 四维数量与占比进度条。
 * 条宽以四维中的最大值为 100%（并非占比 100%），占比数字另以 percent 展示；
 * 为 0 的分段不展示（由 useUsageStats 过滤）。
 */
import type { CompositionSegment } from './useUsageStats'
import { formatTokens } from '@/utils/format'

defineProps<{ segments: CompositionSegment[] }>()

/** 语义色 → tdesign token（不写裸色值） */
function colorOf(tone: CompositionSegment['tone']): string {
  if (tone === 'input') return 'var(--td-brand-color)'
  if (tone === 'output') return 'var(--td-success-color)'
  if (tone === 'cache') return 'var(--td-warning-color)'
  return 'var(--td-text-color-placeholder)'
}
</script>

<style scoped lang="less">
.composition-card {
  padding: 12px 14px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.bar-track {
  height: 6px;
  border-radius: 3px;
  background: var(--td-bg-color-component);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--fluent-transition-normal);
}
</style>
