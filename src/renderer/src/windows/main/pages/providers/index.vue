<template>
  <PageLayout title="提供商">
    <template #extra>
      <t-button @click="openCreate">
        <template #icon><t-icon name="add" /></template>
        新增提供商
      </t-button>
    </template>

    <div class="p-24px">
      <t-table row-key="id" :data="list" :columns="columns" :loading="loading" hover>
        <template #protocol="{ row }">
          <t-tag :theme="PROTOCOL_META[row.protocol].theme" variant="outline" size="small">
            {{ PROTOCOL_META[row.protocol].label }}
          </t-tag>
        </template>
        <template #apiKey="{ row }">
          <span class="text-13px text-td-secondary">{{ maskKey(row.apiKey) }}</span>
        </template>
        <template #modelCount="{ row }">
          <t-tag variant="outline" size="small">{{ row.modelCount }}</t-tag>
        </template>
        <template #enabled="{ row }">
          <t-switch
            :value="row.enabled"
            size="small"
            @change="(v: unknown) => toggleEnabled(row, v === true)"
          />
        </template>
        <template #op="{ row }">
          <t-button variant="text" size="small" theme="primary" @click="openEdit(row)"
            >编辑</t-button
          >
          <t-popconfirm content="删除提供商将一并删除其模型映射，确定删除？" @confirm="remove(row)">
            <t-button variant="text" size="small" theme="danger">删除</t-button>
          </t-popconfirm>
        </template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ProviderInfo, ProviderProtocol } from '@common/types'
import { maskKey } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { openProviderDialog } from './modals/ProviderDialog'
import { MessageUtil } from '@/utils/modal'

const list = ref<ProviderInfo[]>([])
const loading = ref(false)

const PROTOCOL_META: Record<
  ProviderProtocol,
  { label: string; theme: 'default' | 'primary' | 'success' }
> = {
  openai: { label: 'OpenAI Chat', theme: 'default' },
  'openai-responses': { label: 'OpenAI Responses', theme: 'primary' },
  anthropic: { label: 'Anthropic', theme: 'success' }
}

const columns = [
  { colKey: 'name', title: '名称', width: 140 },
  { colKey: 'protocol', title: '协议', width: 150 },
  { colKey: 'baseUrl', title: 'Base URL', ellipsis: true },
  { colKey: 'apiKey', title: 'API Key', width: 150 },
  { colKey: 'modelCount', title: '模型数', width: 90 },
  { colKey: 'enabled', title: '启用', width: 80 },
  { colKey: 'op', title: '操作', width: 130 }
]

async function refresh(): Promise<void> {
  loading.value = true
  try {
    list.value = await window.preload.provider.list()
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  openProviderDialog(null, refresh)
}

function openEdit(row: ProviderInfo): void {
  openProviderDialog(row, refresh)
}

async function toggleEnabled(row: ProviderInfo, enabled: boolean): Promise<void> {
  try {
    await window.preload.provider.update({ ...row, enabled })
    row.enabled = enabled
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function remove(row: ProviderInfo): Promise<void> {
  try {
    await window.preload.provider.remove(row.id)
    MessageUtil.success('已删除')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '删除失败')
  }
  await refresh()
}

onMounted(() => {
  void refresh()
})
</script>
