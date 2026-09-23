<template>
  <div>
    <div class="text-13px text-td-secondary mb-12px">
      链路支线上的数字是该渠道此刻的可用度（即路由权重），占比是按权重推算的首次命中概率；
      会话亲和与探针会让实际分布略有偏移。
    </div>

    <t-alert v-if="!config.enabled" theme="warning" class="mb-12px">
      负载均衡已关闭：请求固定发给每条链路的第一条可用渠道，可用度不影响选路。
    </t-alert>

    <div v-if="chains.length === 0" class="text-13px text-td-secondary">
      暂无可路由的对外模型
    </div>
    <div v-else>
      <div v-for="group in chains" :key="group.publicName" class="chain-list__item">
        <ModelChain :group="group" @refresh="emit('refresh')" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ChannelHealthInfo, ModelMappingInfo } from '@common/types'
import ModelChain from './ModelChain.vue'
import { useModelChains } from '../useModelChains'

/**
 * 链路视图（模型路由页的第二个视图）：逐组渲染链路，回答「这个模型的请求会发给谁、为什么」。
 *
 * 只读观测：启停 / 归档 / 编辑仍走表格视图，这里只留「重置可用度」这个逃生口。
 * 渠道与健康度都由页面传入（健康度轮询由页面独占），本组件不自己取数。
 */
const props = defineProps<{
  models: ModelMappingInfo[]
  health: Map<string, ChannelHealthInfo>
}>()

const emit = defineEmits<{ refresh: [] }>()

const { chains, config } = useModelChains(
  computed(() => props.models),
  computed(() => props.health)
)
</script>

<style scoped lang="less">
/* 组间发丝线分隔：链路多了以后靠它保持可扫读 */
.chain-list__item + .chain-list__item {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--fluent-border-subtle);
}
</style>
