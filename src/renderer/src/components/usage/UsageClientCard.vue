<template>
  <UsageChartCard
    v-if="option"
    title="来源 Agent 请求数（近七天）"
    icon="chart-bar"
    :hint="CLIENT_HINT"
    :option="option"
    :height="height"
  />
</template>

<script lang="ts" setup>
/**
 * 来源客户端请求数卡（按 user-agent 归一出来的来源分组）。
 *
 * 数据源是 request_logs（保留 7 天）而非用量聚合表——聚合表按「时间桶 × 供应商 × 模型」分区、
 * 没有来源维度，窗口固定近七天且不随看板维度与筛选变化，故在本组件内独立取数，不进入
 * useUsageStats（托盘面板不渲染本组件，也就不会白拉一次）。
 */
import { computed, onMounted, ref } from 'vue'
import type { UsageClientStats } from '@common/types'
import UsageChartCard from './UsageChartCard.vue'
import { buildTopBarOption } from '@/components/EChart/options'
import { useChartPalette } from '@/components/EChart/tokens'

const CLIENT_HINT =
  '近七天按来源统计的请求数（含失败请求）。来源 = 请求头 user-agent 首个 token 的名称部分' +
  '（如 kimi-code-desktop / ZCode / opencode），未携带 UA 的请求归入「未知」。' +
  '数据源是请求日志（保留 7 天），因此窗口固定近七天、不随看板维度与筛选变化。'

/** 条形图保留的来源条数上限：按请求数取前 N，其余合并为「其他」 */
const CLIENT_LIMIT = 6

const palette = useChartPalette()
const data = ref<UsageClientStats | null>(null)

/** 前 6 名 + 其他（与供应商条形图同一取舍） */
const chart = computed(() => {
  const items = data.value?.items ?? []
  if (items.length === 0) return null
  const top = items.slice(0, CLIENT_LIMIT)
  const names = top.map((item) => item.name)
  const values = top.map((item) => item.requestCount)
  const rest = items.slice(CLIENT_LIMIT)
  if (rest.length > 0) {
    names.push('其他')
    values.push(rest.reduce((acc, item) => acc + item.requestCount, 0))
  }
  return { names, values }
})

/** 窗口内一条日志都没有时整卡不渲染 */
const option = computed(() => {
  const current = chart.value
  return current ? buildTopBarOption(palette.value, current.names, current.values) : null
})

const height = computed(() =>
  Math.max(120, Math.min((data.value?.items.length ?? 0) + 1, 7) * 28 + 24)
)

onMounted(() => {
  void window.preload.usage.clientStats().then((next) => {
    data.value = next
  })
})
</script>
