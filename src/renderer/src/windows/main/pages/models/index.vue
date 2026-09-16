<template>
  <PageLayout title="模型映射">
    <template #extra>
      <t-button :disabled="!hasProvider" @click="openCreate">
        <template #icon><t-icon name="add" /></template>
        新增映射
      </t-button>
    </template>

    <div class="p-24px">
      <div class="text-13px text-td-secondary mb-12px">
        对外模型名统一暴露给客户端，请求时按映射转发到对应提供商的上游模型
      </div>
      <t-table row-key="id" :data="list" :columns="columns" :loading="loading" hover>
        <template #publicName="{ row }">
          <div class="flex items-center gap-4px">
            <span class="font-500">{{ row.publicName }}</span>
            <t-button variant="text" shape="square" size="small" @click="copyName(row.publicName)">
              <template #icon><t-icon name="file-copy" /></template>
            </t-button>
          </div>
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
          <t-popconfirm content="确定删除该模型映射？" @confirm="remove(row)">
            <t-button variant="text" size="small" theme="danger">删除</t-button>
          </t-popconfirm>
        </template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ModelMappingInfo } from '@common/types'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { openModelDialog } from './modals/ModelDialog'
import { MessageUtil } from '@/utils/modal'

const list = ref<ModelMappingInfo[]>([])
const loading = ref(false)
const providerCount = ref(0)

const hasProvider = computed(() => providerCount.value > 0)

const columns = [
  { colKey: 'publicName', title: '对外模型名' },
  { colKey: 'providerName', title: '提供商', width: 150 },
  { colKey: 'upstreamName', title: '上游模型', width: 200, ellipsis: true },
  { colKey: 'enabled', title: '启用', width: 80 },
  { colKey: 'op', title: '操作', width: 130 }
]

async function refresh(): Promise<void> {
  loading.value = true
  try {
    list.value = await window.preload.model.list()
    providerCount.value = (await window.preload.provider.list()).length
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  openModelDialog(null, refresh)
}

function openEdit(row: ModelMappingInfo): void {
  openModelDialog(row, refresh)
}

async function copyName(name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(name)
    MessageUtil.success('已复制')
  } catch {
    MessageUtil.error('复制失败')
  }
}

async function toggleEnabled(row: ModelMappingInfo, enabled: boolean): Promise<void> {
  try {
    await window.preload.model.update({
      id: row.id,
      providerId: row.providerId,
      publicName: row.publicName,
      upstreamName: row.upstreamName,
      enabled
    })
    row.enabled = enabled
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function remove(row: ModelMappingInfo): Promise<void> {
  try {
    await window.preload.model.remove(row.id)
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
