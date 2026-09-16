<template>
  <PageLayout title="日志">
    <template #extra>
      <t-checkbox :checked="autoRefresh" @change="(v: unknown) => (autoRefresh = v === true)">自动刷新</t-checkbox>
      <t-button variant="outline" size="small" :loading="loading" @click="refresh">
        <template #icon><t-icon name="refresh" /></template>
        刷新
      </t-button>
      <t-popconfirm content="确定清空今天的全部日志？" @confirm="clearToday">
        <t-button variant="outline" size="small" theme="danger" :disabled="!list.length">清空</t-button>
      </t-popconfirm>
    </template>

    <div class="p-24px">
      <div class="text-13px text-td-secondary mb-12px">仅保留当天请求日志，跨天自动清理</div>
      <t-table row-key="id" :data="list" :columns="columns" :loading="loading" hover :empty="'今日暂无请求'">
        <template #time="{ row }">{{ formatTime(row.createdAt) }}</template>
        <template #model="{ row }">
          <div class="font-500">{{ row.publicModel }}</div>
          <div class="text-12px text-td-placeholder">{{ row.providerName }} / {{ row.upstreamModel }}</div>
        </template>
        <template #status="{ row }">
          <t-tag :theme="statusTheme(row.status)" variant="light" size="small">{{ row.status }}</t-tag>
        </template>
        <template #duration="{ row }">{{ row.durationMs }}ms</template>
        <template #tokens="{ row }">
          <t-tooltip :content="`输入 ${row.promptTokens} · 输出 ${row.completionTokens}`">
            <span>{{ formatTokens(row.totalTokens) }}</span>
          </t-tooltip>
        </template>
        <template #error="{ row }">
          <span v-if="row.error" class="text-13px text-td-secondary error-cell">{{ row.error }}</span>
          <span v-else class="text-13px text-td-placeholder">-</span>
        </template>
        <template #op="{ row }">
          <t-button variant="text" size="small" theme="primary" @click="openDetail(row)">详情</t-button>
        </template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'
import type { RequestLogItem } from '@common/types'
import { MessagePlugin } from 'tdesign-vue-next'
import { formatTime, formatTokens, statusTheme } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { openLogDetailDialog } from './modals/LogDetailDialog'

const REFRESH_INTERVAL = 30_000

const list = ref<RequestLogItem[]>([])
const loading = ref(false)
const autoRefresh = ref(true)

let timer: ReturnType<typeof setInterval> | null = null

const columns = [
  { colKey: 'time', title: '时间', width: 90 },
  { colKey: 'model', title: '模型', minWidth: 220 },
  { colKey: 'status', title: '状态', width: 80 },
  { colKey: 'duration', title: '耗时', width: 90 },
  { colKey: 'tokens', title: 'Tokens', width: 100 },
  { colKey: 'error', title: '错误', ellipsis: true },
  { colKey: 'op', title: '', width: 70 }
]

async function refresh(): Promise<void> {
  loading.value = true
  try {
    list.value = await window.preload.log.listToday()
  } finally {
    loading.value = false
  }
}

async function clearToday(): Promise<void> {
  try {
    await window.preload.log.clear()
    MessagePlugin.success('已清空')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '操作失败')
  }
  await refresh()
}

function openDetail(row: RequestLogItem): void {
  openLogDetailDialog(row)
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => {
    if (autoRefresh.value) void refresh()
  }, REFRESH_INTERVAL)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style lang="less" scoped>
.error-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}
</style>
