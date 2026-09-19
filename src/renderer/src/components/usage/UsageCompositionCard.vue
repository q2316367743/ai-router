<template>
  <MetricCard label="令牌构成" icon="chart-pie" :footer="FOOTER_NOTE">
    <template #viz>
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
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 令牌构成：输入 / 输出 / 缓存 / 无法统计 四维数量与占比进度条。
 *
 * 条宽以四维中的最大值为 100%（并非占比 100%），占比数字另以 percent 展示；
 * 为 0 的分段不展示（由 useUsageStats 过滤）。该口径说明原在卡片头部，现移到页脚。
 * 四段各有语义色，因此本卡不用分档色，也不给状态胶囊（构成没有好坏）。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import type { CompositionSegment } from './useUsageStats'
import MetricCard from './MetricCard.vue'
import { formatTokens } from '@/utils/format'

const props = defineProps<{ ctx: DashboardCardContext }>()

const segments = computed<CompositionSegment[]>(() => props.ctx.stats.composition.value)

const FOOTER_NOTE = '条宽以最大值为 100%'

/** 语义色 → tdesign token（不写裸色值） */
function colorOf(tone: CompositionSegment['tone']): string {
  if (tone === 'input') return 'var(--td-brand-color)'
  if (tone === 'output') return 'var(--td-success-color)'
  if (tone === 'cache') return 'var(--td-warning-color)'
  return 'var(--td-text-color-placeholder)'
}
</script>

<style scoped lang="less">
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
