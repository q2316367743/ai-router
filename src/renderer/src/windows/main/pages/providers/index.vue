<template>
  <PageLayout title="提供商">
    <template #extra>
      <div class="flex items-center gap-16px">
        <div class="flex items-center gap-8px">
          <span class="text-13px text-td-secondary">显示已归档</span>
          <t-switch v-model="showArchived" size="small" />
        </div>
        <t-button @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新增提供商
        </t-button>
      </div>
    </template>

    <div class="p-24px">
      <t-table
        row-key="id"
        :data="visibleList"
        :columns="columns"
        :loading="loading"
        :row-class-name="rowClassName"
        hover
      >
        <template #name="{ row }">
          <div class="flex items-center gap-6px">
            <span class="min-w-0 truncate" :title="row.name">{{ row.name }}</span>
            <t-tag v-if="row.kind" variant="outline" size="small">
              {{ PRESET_LABELS[row.kind] }}
            </t-tag>
          </div>
        </template>
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
          <t-tag v-if="row.archivedAt !== null" variant="outline" size="small">已归档</t-tag>
          <t-switch
            v-else
            :value="row.enabled"
            size="small"
            @change="(v: unknown) => toggleEnabled(row, v === true)"
          />
        </template>
        <template #op="{ row }">
          <template v-if="row.archivedAt !== null">
            <t-button variant="text" size="small" theme="primary" @click="restore(row)"
              >恢复</t-button
            >
          </template>
          <template v-else>
            <t-button variant="text" size="small" theme="primary" @click="openEdit(row)"
              >编辑</t-button
            >
            <t-popconfirm :content="archiveConfirmText(row)" @confirm="archive(row)">
              <t-button variant="text" size="small" theme="danger">归档</t-button>
            </t-popconfirm>
          </template>
        </template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ProviderInfo, ProviderProtocol } from '@common/types'
import { maskKey } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { openProviderDrawer } from './modals/ProviderDrawer'
import { PRESET_LABELS } from './presets'
import { MessageUtil } from '@/utils/modal'

const list = ref<ProviderInfo[]>([])
const loading = ref(false)
/** 归档项默认隐藏（归档即不被发现），开关只影响本页视图，不落库 */
const showArchived = ref(false)

const visibleList = computed(() =>
  showArchived.value ? list.value : list.value.filter((p) => p.archivedAt === null)
)

const PROTOCOL_META: Record<
  ProviderProtocol,
  { label: string; theme: 'default' | 'primary' | 'success' }
> = {
  openai: { label: 'OpenAI Chat', theme: 'default' },
  'openai-responses': { label: 'OpenAI Responses', theme: 'primary' },
  anthropic: { label: 'Anthropic', theme: 'success' }
}

const columns = [
  { colKey: 'name', title: '名称', width: 180 },
  { colKey: 'protocol', title: '协议', width: 150 },
  { colKey: 'baseUrl', title: 'Base URL', ellipsis: true },
  { colKey: 'apiKey', title: 'API Key', width: 150 },
  { colKey: 'modelCount', title: '模型数', width: 90 },
  { colKey: 'enabled', title: '启用', width: 80 },
  { colKey: 'op', title: '操作', width: 130 }
]

function rowClassName(params: { row: ProviderInfo }): string {
  return params.row.archivedAt !== null ? 'opacity-60' : ''
}

function archiveConfirmText(row: ProviderInfo): string {
  return row.modelCount > 0
    ? `归档后该提供商与其下 ${row.modelCount} 个模型映射将不再对外提供，确定归档？`
    : '归档后该提供商将不再对外提供，确定归档？'
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    list.value = await window.preload.provider.list()
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  openProviderDrawer(null, refresh)
}

function openEdit(row: ProviderInfo): void {
  openProviderDrawer(row, refresh)
}

async function toggleEnabled(row: ProviderInfo, enabled: boolean): Promise<void> {
  try {
    await window.preload.provider.update({
      id: row.id,
      name: row.name,
      protocol: row.protocol,
      kind: row.kind,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      quotaStrategyId: row.quotaStrategyId,
      strategyConfig: row.strategyConfig,
      enabled
    })
    row.enabled = enabled
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function archive(row: ProviderInfo): Promise<void> {
  try {
    await window.preload.provider.archive(row.id)
    MessageUtil.success('已归档')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '归档失败')
  }
  await refresh()
}

async function restore(row: ProviderInfo): Promise<void> {
  try {
    await window.preload.provider.restore(row.id)
    MessageUtil.success('已恢复，其下模型需在模型映射页逐个恢复')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '恢复失败')
  }
  await refresh()
}

onMounted(() => {
  void refresh()
})
</script>
