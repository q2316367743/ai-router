<template>
  <div class="dashboard">
    <!-- 维度切换（.fluent-segmented：Fluent 分段控件，见 assets/style/tdesign-cover.less）+ 筛选。
         看板是纯展示面，不放任何编辑元素：卡片布局配置在设置页「看板卡片」卡，经广播同步到本组件 -->
    <div class="flex items-center justify-between gap-8px mb-12px flex-wrap">
      <t-radio-group
        v-model="range"
        class="fluent-segmented"
        :class="{ 'fluent-segmented--block': compact }"
        variant="default-filled"
        size="small"
      >
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

    <!-- delay 抑制快速请求的闪烁；托盘紧凑模式下不盖遮罩（面板底是亚克力，遮罩会整块盖住） -->
    <t-loading :loading="loading" :show-overlay="!compact" :delay="200" size="small">
      <!-- 用户把全部卡片隐藏时不留白板：给一行指引（配置入口在设置页） -->
      <div v-if="visibleCards.length === 0" class="empty-hint">
        暂无显示中的卡片，可在主窗口设置页「看板卡片」中开启
      </div>

      <!-- 注册表驱动的单一栅格：指标卡占 1 格，图表卡整行，环形卡半行；
           不用 dense 流——隐藏卡片留下的空位如实呈现，保持用户排定的顺序 -->
      <div v-else class="grid gap-10px" :class="compact ? 'grid-cols-2' : 'grid-cols-4'">
        <component
          :is="card.def.component"
          v-for="card in visibleCards"
          :key="card.def.id"
          :ctx="ctx"
          v-bind="card.def.extraProps"
          :class="spanClass(card.def.span)"
        />
      </div>
    </t-loading>
  </div>
</template>

<script lang="ts" setup>
/**
 * 统计看板主体：主窗口首页与托盘面板共用同一套卡片，渲染完全由卡片注册表驱动。
 *
 * - 统计数据由父组件经 useUsageStats 创建后传入（stats prop），避免同一数据两处拉取；
 *   首页需要把成功率放进顶部系统状态行，故不能由本组件私有取数。
 * - 卡片清单、显示与顺序来自 cardRegistry × useDashboardLayout（按 surface 独立配置），
 *   本组件不写死任何一张卡片；每张卡片自给自足，只收 ctx（见 cardTypes.ts）。
 * - compact=true 时压缩图表高度以适配托盘窄面板（栅格降为 2 列）。
 */
import { computed } from 'vue'
import type { UsageClientStats, UsageModelSpeed, UsageRangeKey } from '@common/types'
import type { UseUsageStatsResult } from './useUsageStats'
import type { DashboardCardContext, DashboardCardSpan } from './cardTypes'
import type { DashboardSurface } from '@common/types'
import { useDashboardLayout } from './useDashboardLayout'

const props = withDefaults(
  defineProps<{
    surface: DashboardSurface
    stats: UseUsageStatsResult
    /** 模型速度趋势数据（固定近七天窗口，由父组件按刷新节拍统一取数；仅首页取） */
    speed?: UsageModelSpeed | null
    /** 来源 Agent 请求数数据（同上） */
    clients?: UsageClientStats | null
    /** 统计维度候选（两端一致：今天 / 近24小时 / 近七天 / 近30天） */
    ranges?: UsageRangeKey[]
    /** 是否展示供应商 / 模型筛选 */
    showFilters?: boolean
    /** 紧凑模式（托盘窄面板）：图表压矮、统计卡两列、维度切换等宽铺满 */
    compact?: boolean
  }>(),
  {
    speed: null,
    clients: null,
    ranges: () => ['today', 'last24h', 'last7d', 'last30d'],
    showFilters: true,
    compact: false
  }
)

const RANGE_LABELS: Record<UsageRangeKey, string> = {
  today: '今天',
  last24h: '近 24 小时',
  last7d: '近七天',
  last30d: '近 30 天'
}

// stats 的每个字段本身就是 ref/computed（useUsageStats 的返回值），卡片内部直接按 ref 取值即保持响应性
const { range, providerName, publicModel, loading, filterOptions } = props.stats

/** 看板传给每张卡片的渲染上下文：卡片据此自取数据与界面形态 */
const ctx = computed<DashboardCardContext>(() => ({
  stats: props.stats,
  compact: props.compact,
  speed: props.speed,
  clients: props.clients
}))

/** 注册表 × 用户布局配置合并出的卡片序列（含隐藏卡，隐藏卡保留位置） */
const { cards } = useDashboardLayout(props.surface)
const visibleCards = computed(() => cards.value.filter((card) => card.visible))

/** 栅格跨度 → 类名：half 在 2 列栅格（托盘）下恰为半行，无需跨列 */
function spanClass(span: DashboardCardSpan): string {
  if (span === 'full') return 'col-span-full'
  if (span === 'half') return props.compact ? '' : 'col-span-2'
  return ''
}

const rangeOptions = computed(() =>
  props.ranges.map((value) => ({ value, label: RANGE_LABELS[value] }))
)

const providerOptions = computed(() =>
  filterOptions.value.providers.map((value) => ({ value, label: value }))
)
const modelOptions = computed(() =>
  filterOptions.value.models.map((value) => ({ value, label: value }))
)
</script>

<style scoped lang="less">
.dashboard {
  color: var(--td-text-color-primary);
}

.empty-hint {
  padding: 32px 0;
  font-size: 12px;
  text-align: center;
  color: var(--td-text-color-placeholder);
}
</style>
