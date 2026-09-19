<template>
  <MetricCard
    :class="config.levelClass"
    :label="config.label"
    :icon="config.icon"
    :pill-text="config.pill?.text"
    :pill-theme="config.pill?.theme"
    :footer="config.footer"
    :value-size="valueSize"
  >
    <t-statistic
      v-if="config.hasValue"
      :value="config.value"
      :unit="config.unit"
      :decimal-places="config.decimalPlaces"
    />
    <span v-else class="stat-empty">—</span>

    <!-- v-if 加在具名插槽上：无可视化时整个插槽不注册，卡片不会多出一段空白 -->
    <template v-if="config.viz" #viz>
      <MiniBars v-if="config.viz.kind === 'bars'" :values="config.viz.values" />
      <MiniProgress v-else :percent="config.viz.percent" />
    </template>
  </MetricCard>
</template>

<script lang="ts" setup>
/**
 * 统计卡（首页 / 托盘面板共用）：按 cardKey 渲染一张统计指标卡。
 *
 * - 展示配置由 buildStatCardConfig 派生（图标 / 胶囊 / 迷你图 / 页脚），computed 内读取
 *   stats 各 ref 保持响应性；
 * - 数值走 t-statistic，颜色不在此处指定 —— 由 config.levelClass 设在卡片根节点上，
 *   经 currentColor 被数值与迷你图继承（色值定义在 assets/style/customer.less）；
 * - 无数据（零请求下的成功率 / 延迟）渲染占位符而不是「0」，避免把「没有请求」读成「成功率 0%」。
 */
import { computed } from 'vue'
import type { DashboardCardContext } from './cardTypes'
import type { StatCardKey } from './useUsageCards'
import { buildStatCardConfig } from './useUsageCards'
import MetricCard from './MetricCard.vue'
import MiniBars from './MiniBars.vue'
import MiniProgress from './MiniProgress.vue'

const props = defineProps<{ ctx: DashboardCardContext; cardKey: StatCardKey }>()

const config = computed(() => buildStatCardConfig(props.ctx.stats, props.cardKey))
const valueSize = computed(() => (props.ctx.compact ? 22 : 26))
</script>

<style scoped lang="less">
.stat-empty {
  font-size: var(--metric-value-size, 26px);
  font-weight: 600;
  line-height: 1.2;
  color: var(--td-text-color-placeholder);
}
</style>
