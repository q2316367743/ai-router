<template>
  <div class="dashboard">
    <!-- 维度切换 + 筛选 -->
    <div class="flex items-center justify-between gap-8px mb-12px flex-wrap">
      <t-radio-group v-model="range" variant="outline" size="small">
        <t-radio-button v-for="item in rangeOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </t-radio-button>
      </t-radio-group>
      <div v-if="showFilters" class="flex items-center gap-8px">
        <t-select
          v-model="providerName"
          :options="providerOptions"
          placeholder="全部供应商"
          size="small"
          clearable
          style="width: 132px"
        />
        <t-select
          v-model="publicModel"
          :options="modelOptions"
          placeholder="全部模型"
          size="small"
          clearable
          style="width: 132px"
        />
      </div>
    </div>

    <t-loading :loading="loading" size="small">
      <div class="flex flex-col gap-12px">
        <!-- 请求数 / 成功率 / 平均延迟 / 总 tokens（窄面板下 2 列两行，避免挤压） -->
        <div class="grid gap-10px" :class="compact ? 'grid-cols-2' : 'grid-cols-4'">
          <UsageStatCard
            v-for="card in cards"
            :key="card.key"
            :config="card"
            :value-size="compact ? 22 : 26"
          />
        </div>

        <!-- 柱状（请求数）+ 折线（总 token / 缓存 token） -->
        <UsageChartCard
          title="请求与用量趋势"
          icon="chart-combo"
          :option="trendOption"
          :height="compact ? 180 : 240"
        />

        <!-- 按供应商分线的 token 趋势（仅小时粒度，托盘 24 小时维度核心图） -->
        <UsageChartCard
          v-if="providerTrendOption"
          title="供应商 Tokens 趋势"
          icon="chart-line"
          :option="providerTrendOption"
          :height="compact ? 160 : 220"
        />

        <!-- 活跃度热力图 -->
        <UsageActivityCard :activity="activity" />

        <!-- 令牌构成（含缓存占比） -->
        <UsageCompositionCard :segments="composition" />

        <!-- 环形指标：成功率 / 失败率 与 缓存占比 -->
        <UsageRatioCard :totals="totals" :cache-tokens="cacheTokens" />

        <!-- 供应商 token 数 -->
        <UsageChartCard
          v-if="providerOption"
          title="供应商 Tokens"
          icon="chart-bar"
          :option="providerOption"
          :height="providerHeight"
        />

        <!-- 模型速度折线（固定近七天窗口，独立于上方的维度切换与筛选） -->
        <UsageSpeedCard v-if="showSpeed" />
      </div>
    </t-loading>
  </div>
</template>

<script lang="ts" setup>
/**
 * 统计看板主体：主窗口首页与托盘面板共用同一套卡片与图表。
 *
 * - 统计数据由父组件经 useUsageStats 创建后传入（stats prop），避免同一数据两处拉取；
 *   首页需要把成功率放进顶部系统状态行，故不能由本组件私有取数。
 * - compact=true 时压缩图表高度以适配托盘窄面板。
 * - showSpeed 单独开关：模型速度折线的数据源与窗口都独立于维度切换，托盘窄面板也不放下多线图。
 */
import { computed } from 'vue'
import type { UsageRangeKey } from '@common/types'
import type { UseUsageStatsResult } from './useUsageStats'
import UsageStatCard from './UsageStatCard.vue'
import UsageChartCard from './UsageChartCard.vue'
import UsageActivityCard from './UsageActivityCard.vue'
import UsageCompositionCard from './UsageCompositionCard.vue'
import UsageRatioCard from './UsageRatioCard.vue'
import UsageSpeedCard from './UsageSpeedCard.vue'
import { useUsageCards } from './useUsageCards'
import {
  buildProviderBarOption,
  buildProviderTrendOption,
  buildRequestTokenOption
} from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const props = withDefaults(
  defineProps<{
    stats: UseUsageStatsResult
    /** 统计维度候选（两端一致：近24小时 / 近七天 / 近30天，「今天」无 UI 入口） */
    ranges?: UsageRangeKey[]
    /** 是否展示供应商 / 模型筛选 */
    showFilters?: boolean
    /** 是否展示模型速度折线（固定近七天，仅主窗口首页开启） */
    showSpeed?: boolean
    /** 紧凑模式（托盘窄面板） */
    compact?: boolean
  }>(),
  {
    ranges: () => ['last24h', 'last7d', 'last30d'],
    showFilters: true,
    showSpeed: false,
    compact: false
  }
)

const RANGE_LABELS: Record<UsageRangeKey, string> = {
  today: '今天',
  last24h: '近 24 小时',
  last7d: '近七天',
  last30d: '近 30 天'
}

const palette = useChartPalette()

// stats 的每个字段本身就是 ref/computed（useUsageStats 的返回值），直接解构即保持响应性，
// 供模板直接绑定（无需再写 stats.range.value 这类层层取值）
const {
  range,
  providerName,
  publicModel,
  loading,
  overview,
  filterOptions,
  cacheTokens,
  composition
} = props.stats

/** 四张统计卡的展示配置（图标 / 胶囊 / 迷你图 / 页脚）在 useUsageCards 里派生 */
const cards = useUsageCards(props.stats)

const rangeOptions = computed(() =>
  props.ranges.map((value) => ({ value, label: RANGE_LABELS[value] }))
)

const providerOptions = computed(() =>
  filterOptions.value.providers.map((value) => ({ value, label: value }))
)
const modelOptions = computed(() =>
  filterOptions.value.models.map((value) => ({ value, label: value }))
)

const totals = computed(() => overview.value.totals)
const activity = computed(() => overview.value.activity)

const trendOption = computed(() => {
  const series = overview.value.series
  return buildRequestTokenOption(
    palette.value,
    series.labels,
    series.requestCount,
    series.totalTokens,
    series.cacheTokens
  )
})

/** 按供应商分线的 token 趋势：仅小时粒度（今天 / 近 24 小时）展示，日粒度下折线过密 */
const providerTrendOption = computed(() => {
  const series = overview.value.series
  if (series.granularity !== 'hour') return null
  const lines = series.byProviderTokens.filter((line) => line.data.some((value) => value > 0))
  if (lines.length === 0) return null
  return buildProviderTrendOption(palette.value, series.labels, lines)
})

/** 供应商条形图：取 token 前 6 名，其余合并为「其他」 */
const providerOption = computed(() => {
  const providers = overview.value.providers.filter((item) => item.totalTokens > 0)
  if (providers.length === 0) return null
  const top = providers.slice(0, 6)
  const rest = providers.slice(6)
  const names = top.map((item) => item.key)
  const values = top.map((item) => item.totalTokens)
  if (rest.length > 0) {
    names.push('其他')
    values.push(rest.reduce((acc, item) => acc + item.totalTokens, 0))
  }
  return buildProviderBarOption(palette.value, names, values)
})

const providerHeight = computed(() =>
  Math.max(120, Math.min(overview.value.providers.length + 1, 7) * 28 + 24)
)
</script>

<style scoped lang="less">
.dashboard {
  color: var(--td-text-color-primary);
}
</style>
