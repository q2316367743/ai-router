<template>
  <div class="channel-panel">
    <t-table row-key="id" :data="channels" :columns="columns" size="small" :bordered="false">
      <template #provider="{ row }">
        <div class="flex items-center gap-6px">
          <span>{{ row.providerName }}</span>
          <t-tag
            v-if="row.providerArchivedAt !== null"
            theme="warning"
            variant="outline"
            size="small"
            >提供商已归档</t-tag
          >
        </div>
      </template>
      <template #health="{ row }">
        <ChannelHealthTag :info="health.get(row.providerId) ?? null" />
      </template>
      <template #enabled="{ row }">
        <t-tag v-if="row.archivedAt !== null" variant="outline" size="small">已归档</t-tag>
        <t-tag v-else-if="row.providerArchivedAt !== null" variant="outline" size="small"
          >不可用</t-tag
        >
        <t-switch
          v-else
          :value="row.enabled"
          size="small"
          @change="(v: unknown) => toggle(row, v === true)"
        />
      </template>
      <template #op="{ row }">
        <t-button
          v-if="row.archivedAt !== null"
          variant="text"
          size="small"
          theme="primary"
          @click="restore(row)"
          >恢复</t-button
        >
        <template v-else>
          <t-button variant="text" size="small" theme="primary" @click="emit('edit', row)"
            >编辑</t-button
          >
          <t-button
            v-if="needsReset(row)"
            variant="text"
            size="small"
            theme="warning"
            @click="reset(row)"
            >重置</t-button
          >
          <t-popconfirm
            content="归档后该渠道不再参与转发（对外名由组内其它渠道继续承载），确定归档？"
            @confirm="archive(row)"
          >
            <t-button variant="text" size="small" theme="danger">归档</t-button>
          </t-popconfirm>
        </template>
      </template>
    </t-table>

    <t-button variant="text" size="small" class="mt-4px" @click="emit('add')">
      <template #icon>
        <add-icon />
      </template>
      新增渠道
    </t-button>
  </div>
</template>

<script lang="ts" setup>
import { AddIcon } from 'tdesign-icons-vue-next'
import type { ChannelHealthInfo, ModelMappingInfo } from '@common/types'
import ChannelHealthTag from './ChannelHealthTag.vue'
import { MessageUtil } from '@/utils/modal'

/**
 * 对外模型展开区的渠道表：一个渠道一行（提供商 + 上游模型 + 健康 + 启停 + 操作）。
 *
 * 渠道级动作（启停/归档/恢复/重置）在此就地完成并回调 `refresh` 让页面重取；
 * 新增/编辑由页面打开弹窗（表单需要全量渠道列表做题名与提供商去重）。
 */
const props = defineProps<{
  channels: ModelMappingInfo[]
  health: Map<string, ChannelHealthInfo>
}>()

const emit = defineEmits<{
  add: []
  edit: [row: ModelMappingInfo]
  refresh: []
}>()

const columns = [
  { colKey: 'provider', title: '提供商', width: 200 },
  { colKey: 'upstreamName', title: '上游模型', ellipsis: true },
  { colKey: 'health', title: '健康', width: 140 },
  { colKey: 'enabled', title: '启用', width: 90 },
  { colKey: 'op', title: '操作', width: 200 }
]

/** 非正常状态才给「重置」入口：那是充值 / 修好 Key 后不想等下一轮余量刷新的逃生口 */
function needsReset(row: ModelMappingInfo): boolean {
  const info = props.health.get(row.providerId)
  return !!info && info.state !== 'healthy'
}

async function toggle(row: ModelMappingInfo, enabled: boolean): Promise<void> {
  try {
    await window.preload.model.update({
      id: row.id,
      providerId: row.providerId,
      upstreamName: row.upstreamName,
      enabled
    })
    row.enabled = enabled
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function archive(row: ModelMappingInfo): Promise<void> {
  await run(() => window.preload.model.archive(row.id), '已归档')
}

async function restore(row: ModelMappingInfo): Promise<void> {
  await run(() => window.preload.model.restore(row.id), '已恢复')
}

async function reset(row: ModelMappingInfo): Promise<void> {
  await run(() => window.preload.balancer.reset(row.providerId), '已重置可用度')
}

async function run(action: () => Promise<void>, successText: string): Promise<void> {
  try {
    await action()
    MessageUtil.success(successText)
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
  emit('refresh')
}
</script>

<style scoped lang="less">
.channel-panel {
  padding: 4px 0 8px 24px;
}
</style>
