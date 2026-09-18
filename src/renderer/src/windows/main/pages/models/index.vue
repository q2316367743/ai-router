<template>
  <PageLayout title="模型映射">
    <template #extra>
      <div class="flex items-center gap-16px">
        <div class="flex items-center gap-8px">
          <span class="text-13px text-td-secondary">显示已归档</span>
          <t-switch v-model="showArchived" size="small" />
        </div>
        <t-button :disabled="!hasProvider" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新增映射
        </t-button>
      </div>
    </template>

    <div class="p-24px">
      <div class="text-13px text-td-secondary mb-12px">
        对外模型名统一暴露给客户端，请求时按映射转发到对应提供商的上游模型
      </div>
      <t-table
        row-key="id"
        :data="visibleList"
        :columns="columns"
        :loading="loading"
        :row-class-name="rowClassName"
        hover
      >
        <template #publicName="{ row }">
          <div class="flex items-center gap-4px">
            <span class="font-500">{{ row.publicName }}</span>
            <t-button variant="text" shape="square" size="small" @click="copyName(row.publicName)">
              <template #icon><t-icon name="file-copy" /></template>
            </t-button>
          </div>
        </template>
        <template #enabled="{ row }">
          <t-tag v-if="row.archivedAt !== null" variant="outline" size="small">已归档</t-tag>
          <t-tag
            v-else-if="row.providerArchivedAt !== null"
            theme="warning"
            variant="outline"
            size="small"
            >提供商已归档</t-tag
          >
          <t-switch
            v-else
            :value="row.enabled"
            size="small"
            @change="(v: unknown) => toggleEnabled(row, v === true)"
          />
        </template>
        <template #op="{ row }">
          <template v-if="row.providerArchivedAt !== null">
            <span class="text-13px text-td-secondary">请先恢复提供商</span>
          </template>
          <template v-else-if="row.archivedAt !== null">
            <t-button variant="text" size="small" theme="primary" @click="restore(row)"
              >恢复</t-button
            >
          </template>
          <template v-else>
            <t-button variant="text" size="small" theme="primary" @click="openEdit(row)"
              >编辑</t-button
            >
            <t-popconfirm
              content="归档后该模型不再出现在 /v1/models 列表中，调用返回 404（已归档），确定归档？"
              @confirm="archive(row)"
            >
              <t-button variant="text" size="small" theme="danger">归档</t-button>
            </t-popconfirm>
          </template>
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
/** 归档项默认隐藏（归档即不被发现），开关只影响本页视图，不落库 */
const showArchived = ref(false)
const providerCount = ref(0)

/** 新增映射的可用性只看未归档提供商（归档提供商不可作为新映射的归宿） */
const hasProvider = computed(() => providerCount.value > 0)

const visibleList = computed(() =>
  showArchived.value ? list.value : list.value.filter((m) => m.archivedAt === null)
)

const columns = [
  { colKey: 'publicName', title: '对外模型名' },
  { colKey: 'providerName', title: '提供商', width: 150 },
  { colKey: 'upstreamName', title: '上游模型', width: 200, ellipsis: true },
  { colKey: 'enabled', title: '启用', width: 110 },
  { colKey: 'op', title: '操作', width: 130 }
]

function rowClassName(params: { row: ModelMappingInfo }): string {
  return params.row.archivedAt !== null || params.row.providerArchivedAt !== null
    ? 'opacity-60'
    : ''
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    list.value = await window.preload.model.list()
    const providers = await window.preload.provider.list()
    providerCount.value = providers.filter((p) => p.archivedAt === null).length
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

async function archive(row: ModelMappingInfo): Promise<void> {
  try {
    await window.preload.model.archive(row.id)
    MessageUtil.success('已归档')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '归档失败')
  }
  await refresh()
}

async function restore(row: ModelMappingInfo): Promise<void> {
  try {
    await window.preload.model.restore(row.id)
    MessageUtil.success('已恢复')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '恢复失败')
  }
  await refresh()
}

onMounted(() => {
  void refresh()
})
</script>
