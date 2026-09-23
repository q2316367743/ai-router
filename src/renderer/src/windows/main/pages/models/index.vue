<template>
  <PageLayout title="模型路由">
    <template #extra>
      <div class="flex items-center gap-16px">
        <div v-if="view === 'table'" class="flex items-center gap-8px">
          <span class="text-13px text-td-secondary">显示已归档</span>
          <t-switch v-model="showArchived" size="small" />
        </div>
        <t-radio-group
          v-model="view"
          class="fluent-segmented"
          variant="default-filled"
          size="small"
        >
          <t-radio-button value="table">表格</t-radio-button>
          <t-radio-button value="chain">链路</t-radio-button>
        </t-radio-group>
        <t-button :disabled="!hasProvider" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新增对外模型
        </t-button>
      </div>
    </template>

    <div class="p-24px">
      <div v-if="view === 'table'" class="text-13px text-td-secondary mb-12px">
        对外模型名统一暴露给客户端；同一名称下的多个渠道互为故障转移候选，按可用度分流，
        同一会话优先固定在同一渠道。展开一行可管理该名称下的渠道。
      </div>
      <t-table
        v-if="view === 'table'"
        v-model:expanded-row-keys="expandedKeys"
        row-key="publicName"
        :data="visibleGroups"
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
        <template #channels="{ row }">
          <span class="text-13px">{{ row.channels.length }} 个渠道</span>
        </template>
        <template #health="{ row }">
          <t-tag :theme="groupHealthOf(row).theme" variant="light" size="small">
            {{ groupHealthOf(row).label }}
          </t-tag>
        </template>
        <template #enabled="{ row }">
          <t-tag v-if="row.archived" variant="outline" size="small">已归档</t-tag>
          <div v-else class="flex items-center gap-6px">
            <t-switch
              :value="row.allEnabled"
              size="small"
              @change="(v: unknown) => toggleGroup(row, v === true)"
            />
            <span class="text-12px text-td-secondary"
              >{{ row.enabledCount }}/{{ row.channels.length }}</span
            >
          </div>
        </template>
        <template #op="{ row }">
          <template v-if="row.archived">
            <t-button variant="text" size="small" theme="primary" @click="restoreGroup(row)"
              >恢复</t-button
            >
          </template>
          <template v-else>
            <t-button variant="text" size="small" theme="primary" @click="renameGroup(row)"
              >重命名</t-button
            >
            <t-popconfirm
              content="归档后该对外模型整体下线，调用返回 404（已归档），确定归档？"
              @confirm="archiveGroup(row)"
            >
              <t-button variant="text" size="small" theme="danger">归档</t-button>
            </t-popconfirm>
          </template>
        </template>
        <template #expanded-row="{ row }">
          <ChannelTable
            :channels="row.channels"
            :health="health"
            @add="openAddChannel(row.publicName)"
            @edit="openEdit"
            @refresh="refresh"
          />
        </template>
      </t-table>
      <ModelChainList v-else :models="list" :health="health" @refresh="reload" />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ModelMappingInfo } from '@common/types'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import ChannelTable from './components/ChannelTable.vue'
import ModelChainList from './components/ModelChainList.vue'
import { openGroupRenameDialog } from './modals/GroupRenameDialog'
import { openModelDialog } from './modals/ModelDialog'
import { useChannelHealth } from './useChannelHealth'
import { MessageUtil } from '@/utils/modal'

/** 对外模型组：同一 publicName 下的渠道集合（名字靠渠道行承载，没有行就没有这个名字） */
interface ModelGroup {
  publicName: string
  /** 当前可见的渠道（「显示已归档」关闭时只含未归档渠道） */
  channels: ModelMappingInfo[]
  /** 组内渠道全部启用 */
  allEnabled: boolean
  enabledCount: number
  /** 组内渠道全部已归档（自身或提供商） */
  archived: boolean
}

/** 视图切换：表格 = 管理（增删改启停），链路 = 观测（可用度与分流占比） */
type ViewMode = 'table' | 'chain'

const list = ref<ModelMappingInfo[]>([])
const loading = ref(false)
const view = ref<ViewMode>('table')
const showArchived = ref(false)
const providerCount = ref(0)
const expandedKeys = ref<Array<string | number>>([])
const { health, reload } = useChannelHealth()

/** 新增仅在存在未归档提供商时可用（归档提供商不可作为新渠道的归宿） */
const hasProvider = computed(() => providerCount.value > 0)

const groups = computed<ModelGroup[]>(() => {
  const buckets = new Map<string, ModelMappingInfo[]>()
  for (const channel of list.value) {
    const bucket = buckets.get(channel.publicName)
    if (bucket) bucket.push(channel)
    else buckets.set(channel.publicName, [channel])
  }
  return [...buckets].map(([publicName, all]) => {
    const channels = showArchived.value ? all : all.filter((channel) => channel.archivedAt === null)
    const active = all.filter((channel) => channel.archivedAt === null)
    return {
      publicName,
      channels,
      allEnabled: active.length > 0 && active.every((channel) => channel.enabled),
      enabledCount: active.filter((channel) => channel.enabled).length,
      archived: all.every(
        (channel) => channel.archivedAt !== null || channel.providerArchivedAt !== null
      )
    }
  })
})

/** 归档开关只影响本页视图：整组都归档的对外模型一并隐藏 */
const visibleGroups = computed(() => groups.value.filter((group) => group.channels.length > 0))

const columns = [
  { colKey: 'publicName', title: '对外模型名' },
  { colKey: 'channels', title: '渠道', width: 110 },
  { colKey: 'health', title: '渠道健康', width: 130 },
  { colKey: 'enabled', title: '启用', width: 140 },
  { colKey: 'op', title: '操作', width: 150 }
]

function rowClassName(params: { row: ModelGroup }): string {
  return params.row.archived ? 'opacity-60' : ''
}

/** 组级健康：以最差状态示警（额度耗尽 > 降级中 > 正常），细节在展开区逐渠道看 */
function groupHealthOf(group: ModelGroup): {
  label: string
  theme: 'success' | 'warning' | 'danger'
} {
  const states = group.channels.map((channel) => health.value.get(channel.providerId)?.state)
  const blocked = states.filter((state) => state === 'blocked').length
  const degraded = states.filter((state) => state === 'degraded').length
  if (blocked > 0) return { label: `${blocked} 个额度耗尽`, theme: 'danger' }
  if (degraded > 0) return { label: `${degraded} 个降级中`, theme: 'warning' }
  return { label: '正常', theme: 'success' }
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
  openModelDialog({ mapping: null, channels: list.value, onSaved: refresh })
}

function openAddChannel(publicName: string): void {
  openModelDialog({ mapping: null, presetName: publicName, channels: list.value, onSaved: refresh })
}

function openEdit(row: ModelMappingInfo): void {
  openModelDialog({ mapping: row, channels: list.value, onSaved: refresh })
}

function renameGroup(row: ModelGroup): void {
  openGroupRenameDialog(row.publicName, refresh)
}

async function copyName(name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(name)
    MessageUtil.success('已复制')
  } catch {
    MessageUtil.error('复制失败')
  }
}

/** 组级启停：一次改该名下全部未归档渠道（关掉再打开会把此前单独停用的渠道一并启用） */
async function toggleGroup(row: ModelGroup, enabled: boolean): Promise<void> {
  await run(() => window.preload.model.groupEnabled({ publicName: row.publicName, enabled }))
}

async function archiveGroup(row: ModelGroup): Promise<void> {
  await run(() => window.preload.model.groupArchive(row.publicName), '已归档')
}

async function restoreGroup(row: ModelGroup): Promise<void> {
  await run(() => window.preload.model.groupRestore(row.publicName), '已恢复')
}

async function run(action: () => Promise<void>, successText?: string): Promise<void> {
  try {
    await action()
    if (successText) MessageUtil.success(successText)
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
  await refresh()
}

onMounted(() => {
  void refresh()
})
</script>
