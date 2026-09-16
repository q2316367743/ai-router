<template>
  <div class="donut-card">
    <div class="donut-item">
      <div class="donut-title">成功率</div>
      <EChart :option="successOption" :height="140" />
    </div>
    <div class="donut-item">
      <div class="donut-title">缓存占比</div>
      <EChart :option="cacheOption" :height="140" />
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 环形指标：成功率 / 失败率 与 缓存占比。
 * 两图均为两段环形（主值 vs 余量），中心显示主占比，配色取 tdesign token。
 */
import { computed } from 'vue'
import type { UsageTotals } from '@common/types'
import EChart from '@/components/EChart/EChart.vue'
import { buildRatioDonutOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const props = defineProps<{
  totals: UsageTotals
  cacheTokens: number
}>()

const palette = useChartPalette()

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

const cacheOption = computed(() => {
  const cache = props.cacheTokens
  const other = Math.max(0, props.totals.totalTokens - cache)
  return buildRatioDonutOption(palette.value, '缓存', cache, '非缓存', other, palette.value.warning)
})
</script>

<style scoped lang="less">
.donut-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.donut-item {
  padding: 12px 14px 0;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.donut-title {
  font-size: 13px;
  font-weight: 500;
}
</style>
