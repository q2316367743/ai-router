<template>
  <div class="ratio-grid">
    <MetricCard
      label="成功率"
      icon="chart-ring"
      :pill-text="pill?.text"
      :pill-theme="pill?.theme"
      :class="successClass"
      :footer="`成功 ${totals.successCount} · 失败 ${totals.failCount}`"
    >
      <template #viz>
        <EChart :option="successOption" :height="140" />
      </template>
    </MetricCard>

    <MetricCard
      label="缓存占比"
      icon="chart-ring"
      :footer="`缓存 ${formatTokens(cacheTokens)} · 非缓存 ${formatTokens(otherTokens)}`"
    >
      <template #viz>
        <EChart :option="cacheOption" :height="140" />
      </template>
    </MetricCard>
  </div>
</template>

<script lang="ts" setup>
/**
 * 环形指标：成功率 / 失败率 与 缓存占比。
 *
 * 两张卡均为两段环形（主值 vs 余量），中心显示主占比，配色取 tdesign token。
 * 数值已在环形中心，故本卡不设大数值段；成功率复用统计卡同一套胶囊文案与分档色，
 * 缓存占比没有好坏阈值，因此不给胶囊。
 */
import { computed } from 'vue'
import type { UsageTotals } from '@common/types'
import EChart from '@/components/EChart/EChart.vue'
import { buildRatioDonutOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'
import MetricCard from './MetricCard.vue'
import { successPill } from './useUsageCards'
import { successSeverity } from './useUsageStats'
import { formatTokens } from '@/utils/format'

const props = defineProps<{
  totals: UsageTotals
  cacheTokens: number
}>()

const palette = useChartPalette()

const successRate = computed(() =>
  props.totals.requestCount > 0
    ? (props.totals.successCount / props.totals.requestCount) * 100
    : null
)

const pill = computed(() => successPill(successRate.value))

/** 分档色类：环形卡的渐晕与统计卡同源（阈值来自 useUsageStats，不在此重复定义） */
const successClass = computed(() => {
  const severity = successSeverity(successRate.value)
  return severity ? `stat-${severity}` : ''
})

const otherTokens = computed(() => Math.max(0, props.totals.totalTokens - props.cacheTokens))

const successOption = computed(() =>
  buildRatioDonutOption(
    palette.value,
    '成功',
    props.totals.successCount,
    '失败',
    props.totals.failCount,
    palette.value.success
  )
)

const cacheOption = computed(() =>
  buildRatioDonutOption(
    palette.value,
    '缓存',
    props.cacheTokens,
    '非缓存',
    otherTokens.value,
    palette.value.warning
  )
)
</script>

<style scoped lang="less">
.ratio-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
</style>
