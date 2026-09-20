<template>
  <UsageChartCard
    v-if="option"
    title="Agent 与提供商流向（近七天）"
    icon="flowchart"
    :hint="SANKEY_HINT"
    :option="option"
    :height="height"
  />
</template>

<script lang="ts" setup>
/**
 * Agent → 本地路由 → 提供商 三段式桑基图卡（仅首页）。
 *
 * 数据源是 request_logs（同时有来源 client 与 provider_name），窗口固定近七天、不随看板
 * 维度与筛选变化——与「来源 Agent 请求数」「模型速度」同一取舍，故取数由首页统一挂在刷新
 * 节拍上（见 pages/home/index.vue），本组件只负责展示。无连线时整卡不渲染。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import UsageChartCard from './UsageChartCard.vue'
import { buildAgentProviderSankeyOption } from '@/components/EChart/optionsFlow'
import { useChartPalette } from '@/components/EChart/tokens'

const SANKEY_HINT =
  '近七天按来源 Agent → 本地路由 → 提供商的请求数流向（含失败请求）。来源 = 请求头 user-agent ' +
  '首个 token 的名称部分，未携带 UA 归「未知」；左右两侧各取前 6 名，其余合并为「其他」。' +
  '数据源是请求日志（保留 7 天），因此窗口固定近七天、不随看板维度与筛选变化。'

const props = defineProps<{ ctx: DashboardCardContext }>()

const palette = useChartPalette()

/** 无连线（窗口内无请求）时不渲染整卡 */
const option = computed(() =>
  buildAgentProviderSankeyOption(palette.value, props.ctx.agentFlow?.links ?? [])
)

const height = computed(() => 320)
</script>
