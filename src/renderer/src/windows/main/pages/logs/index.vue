<template>
  <PageLayout title="日志">
    <template #extra>
      <t-checkbox :checked="autoRefresh" @change="(v: unknown) => (autoRefresh = v === true)"
        >自动刷新</t-checkbox
      >
      <t-button variant="outline" size="small" :loading="loading" @click="refresh">
        <template #icon><t-icon name="refresh" /></template>
        刷新
      </t-button>
      <t-popconfirm content="确定清空全部日志（保留窗口内 7 天）？" @confirm="clearAll">
        <t-button variant="outline" size="small" theme="danger" :disabled="!total">清空</t-button>
      </t-popconfirm>
    </template>

    <div class="px-24px">
      <div class="flex items-center gap-12px mb-12px">
        <t-radio-group :value="status" variant="outline" size="small" @change="onStatusChange">
          <t-radio-button value="all">全部</t-radio-button>
          <t-radio-button value="success">成功</t-radio-button>
          <t-radio-button value="fail">失败</t-radio-button>
        </t-radio-group>
        <t-select
          v-model="provider"
          :options="providerOptions"
          placeholder="全部供应商"
          clearable
          size="small"
          class="w-180px"
        />
        <t-select
          v-model="model"
          :options="modelOptions"
          placeholder="全部模型"
          clearable
          size="small"
          class="w-180px"
        />
      </div>

      <t-table
        v-model:expanded-row-keys="expandedKeys"
        row-key="id"
        :data="list"
        :columns="columns"
        :loading="loading"
        hover
        empty="暂无请求日志"
        :expand-on-row-click="true"
        :pagination="pagination"
        max-height="calc(100vh - 148px)"
        @page-change="onPageChange"
      >
        <template #time="{ row }">{{ formatDateTime(row.startedAt) }}</template>
        <template #status="{ row }">
          <span
            class="status-dot"
            :class="isSuccessStatus(row.status) ? 'dot-ok' : 'dot-fail'"
          ></span
          >{{ row.status }}
        </template>
        <template #streamCell="{ row }">
          <t-tag v-if="row.stream" variant="outline" size="small">流式</t-tag>
          <span v-else class="text-13px text-td-placeholder">非流式</span>
        </template>
        <template #model="{ row }">
          <div class="font-500">{{ row.publicModel }}</div>
          <div class="text-12px text-td-placeholder">
            {{ row.providerName }} / {{ row.upstreamModel }}
          </div>
        </template>
        <template #tokens="{ row }">
          <t-tooltip :content="tokensTooltip(row)">
            <div>
              <div>
                入 {{ formatTokens(row.promptTokens) }} · 出
                {{ formatTokens(row.completionTokens) }}
              </div>
              <div class="text-12px text-td-placeholder">
                缓存 {{ formatTokens(row.cacheReadTokens + row.cacheWriteTokens) }} · 思考
                {{ formatTokens(row.reasoningTokens) }}
              </div>
            </div>
          </t-tooltip>
        </template>
        <template #duration="{ row }">{{ formatDuration(row.durationMs) }}</template>
        <template #expanded-row="{ row }">
          <LogExpandedRow :id="row.id" />
        </template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { PageInfo } from 'tdesign-vue-next'
import type { LogStatusFilter, RequestLogItem } from '@common/types'
import { formatDateTime, formatDuration, formatTokens, isSuccessStatus } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import LogExpandedRow from './components/LogExpandedRow.vue'
import { MessageUtil } from '@/utils/modal'

const PAGE_SIZE = 25
const REFRESH_INTERVAL = 30_000

type SelectOption = { label: string; value: string }

const list = ref<RequestLogItem[]>([])
const total = ref(0)
const loading = ref(false)
const autoRefresh = ref(true)
const status = ref<LogStatusFilter>('all')
const provider = ref<string>('')
const model = ref<string>('')
const page = ref(1)
const expandedKeys = ref<Array<string | number>>([])
const providerOptions = ref<SelectOption[]>([])
const modelOptions = ref<SelectOption[]>([])

let timer: ReturnType<typeof setInterval> | null = null

const columns = [
  { colKey: 'time', title: '时间', width: 130 },
  { colKey: 'status', title: '状态', width: 80 },
  { colKey: 'streamCell', title: '流式', width: 80 },
  { colKey: 'model', title: '模型', minWidth: 210 },
  { colKey: 'tokens', title: 'Token', width: 180 },
  { colKey: 'duration', title: '持续时间', width: 90 }
]

const pagination = computed(() => ({
  current: page.value,
  pageSize: PAGE_SIZE,
  total: total.value,
  showJumper: true
}))

function tokensTooltip(row: RequestLogItem): string {
  return `输入 ${row.promptTokens} · 输出 ${row.completionTokens} · 思考 ${row.reasoningTokens} · 缓存读 ${row.cacheReadTokens} · 缓存写 ${row.cacheWriteTokens} · 估算 ${row.unrecognizedTokens} · 总计 ${row.totalTokens}`
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const result = await window.preload.log.list({
      status: status.value,
      provider: provider.value || null,
      model: model.value || null,
      page: page.value,
      pageSize: PAGE_SIZE
    })
    list.value = result.items
    total.value = result.total
  } finally {
    loading.value = false
  }
}

async function loadOptions(): Promise<void> {
  const options = await window.preload.log.filterOptions()
  providerOptions.value = options.providers.map((p) => ({ label: p, value: p }))
  modelOptions.value = options.models.map((m) => ({ label: m, value: m }))
}

function onStatusChange(value: string | number | boolean): void {
  if (value === 'all' || value === 'success' || value === 'fail') {
    status.value = value
    page.value = 1
    void refresh()
  }
}

function onPageChange(info: PageInfo): void {
  page.value = info.current
  void refresh()
}

async function clearAll(): Promise<void> {
  try {
    await window.preload.log.clearAll()
    MessageUtil.success('已清空')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
  await refresh()
}

// 供应商 / 模型筛选变化：回到第 1 页重新查询
watch(provider, () => {
  page.value = 1
  void refresh()
})
watch(model, () => {
  page.value = 1
  void refresh()
})

onMounted(() => {
  void loadOptions()
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
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.dot-ok {
  background: var(--td-success-color);
}

.dot-fail {
  background: var(--td-error-color);
}
</style>
