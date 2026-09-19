<template>
  <div class="flex flex-col gap-12px">
    <div class="flex items-center justify-between">
      <span class="text-12px text-td-secondary">
        内置策略随应用内置、不可卸载；外置策略为你自己的 JS 脚本，可安装、停用与归档。
      </span>
      <div class="flex items-center gap-8px">
        <t-button size="small" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建策略
        </t-button>
        <t-button size="small" variant="outline" @click="emit('close')">关闭</t-button>
      </div>
    </div>

    <t-table
      row-key="id"
      :data="rows"
      :columns="columns"
      :loading="loading"
      hover
      max-height="440px"
    >
      <template #credential="{ row }">
        <t-tag :theme="CREDENTIAL_META[row.credential].theme" variant="light" size="small">
          {{ CREDENTIAL_META[row.credential].label }}
        </t-tag>
      </template>
      <template #builtin="{ row }">
        <t-tag :theme="row.builtin ? 'default' : 'primary'" variant="outline" size="small">
          {{ row.builtin ? '内置' : '外置' }}
        </t-tag>
      </template>
      <template #op="{ row }">
        <template v-if="!row.builtin">
          <t-button variant="text" size="small" theme="primary" @click="openEdit(row)"
            >编辑</t-button
          >
          <t-popconfirm
            content="归档后该策略将不可用，且绑定的提供商会解除绑定，确定归档？"
            @confirm="archive(row)"
          >
            <t-button variant="text" size="small" theme="danger">归档</t-button>
          </t-popconfirm>
        </template>
        <span v-else class="text-12px text-td-placeholder">随应用内置</span>
      </template>
      <template #empty><t-empty title="暂无策略" /></template>
    </t-table>
  </div>
</template>

<script lang="ts" setup>
import type { QuotaPluginInfo, QuotaStrategyInfo } from '@common/types'
import { MessageUtil } from '@/utils/modal'
import { openPluginDrawer } from './PluginDrawer'

const emit = defineEmits<{
  changed: []
  close: []
}>()

const strategies = ref<QuotaStrategyInfo[]>([])
const plugins = ref<QuotaPluginInfo[]>([])
const loading = ref(false)

const CREDENTIAL_META: Record<
  string,
  { label: string; theme: 'default' | 'primary' | 'warning' | 'success' }
> = {
  apiKey: { label: 'API Key', theme: 'default' },
  token: { label: '访问令牌', theme: 'primary' },
  cookie: { label: 'Cookie', theme: 'warning' },
  none: { label: '无需凭证', theme: 'success' }
}

const columns = [
  { colKey: 'label', title: '策略', width: 150 },
  { colKey: 'builtin', title: '类型', width: 80 },
  { colKey: 'credential', title: '凭证', width: 100 },
  { colKey: 'description', title: '说明', ellipsis: true },
  { colKey: 'op', title: '操作', width: 120 }
]

interface CatalogRow extends QuotaStrategyInfo {
  plugin: QuotaPluginInfo | null
}

/** 目录 = 注册表全量；外置行再挂上插件行（编辑需要脚本正文） */
const rows = computed<CatalogRow[]>(() =>
  strategies.value.map((strategy) => ({
    ...strategy,
    plugin: plugins.value.find((p) => p.id === strategy.id) ?? null
  }))
)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [strategiesRes, pluginsRes] = await Promise.all([
      window.preload.quota.strategies(),
      window.preload.quotaPlugin.list()
    ])
    strategies.value = strategiesRes
    plugins.value = pluginsRes
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  openPluginDrawer(null, refresh)
  emit('close')
}

function openEdit(row: CatalogRow): void {
  if (!row.plugin) {
    MessageUtil.warning('找不到该策略的脚本数据')
    return
  }
  openPluginDrawer(row.plugin, () => {
    void refresh()
  })
}

async function archive(row: CatalogRow): Promise<void> {
  try {
    await window.preload.quotaPlugin.archive(row.id)
    MessageUtil.success('已归档')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '归档失败')
  }
  await refresh()
  emit('changed')
}

onMounted(() => {
  void refresh()
})
</script>
