<template>
  <PageLayout title="用量统计">
    <template #extra>
      <t-date-range-picker
        v-model="range"
        mode="date"
        value-type="YYYY-MM-DD"
        :clearable="false"
        allow-input
        @change="load"
      />
    </template>

    <div class="p-24px">
      <div class="text-13px text-td-secondary mb-12px">
        每日使用量按「日期 × 供应商 × 模型」永久保留；看板图表见
        <router-link to="/home" class="text-td-brand">概览页</router-link>
      </div>

      <div class="grid grid-cols-4 gap-16px mb-16px">
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">区间请求数</div>
          <div class="text-24px font-600">{{ summary.requestCount }}</div>
          <div class="text-12px text-td-placeholder mt-4px">
            成功 {{ summary.successCount }} · 失败 {{ summary.failCount }}
          </div>
        </div>
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">输入 Tokens</div>
          <div class="text-24px font-600">{{ formatTokens(summary.promptTokens) }}</div>
        </div>
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">输出 Tokens</div>
          <div class="text-24px font-600">{{ formatTokens(summary.completionTokens) }}</div>
        </div>
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">缓存 Tokens</div>
          <div class="text-24px font-600">{{ formatTokens(summary.cacheTokens) }}</div>
          <div class="text-12px text-td-placeholder mt-4px">占总量 {{ cacheRatioText }}</div>
        </div>
      </div>

      <t-table
        row-key="date-provider-model"
        :data="list"
        :columns="columns"
        :loading="loading"
        hover
        :empty="'所选区间内暂无使用记录'"
      >
        <template #totalTokens="{ row }">{{ formatTokens(row.totalTokens) }}</template>
      </t-table>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
/**
 * 用量明细表：按「日期 × 供应商 × 模型」永久保留的原始聚合行。
 * 图表看板在概览页；本页保留为可精确核查的明细视图（含自定义日期区间）。
 */
import { computed, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import type { UsageDailyItem } from '@common/types'
import { formatTokens } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'

const DEFAULT_RANGE_DAYS = 30

const list = ref<UsageDailyItem[]>([])
const loading = ref(false)
const range = ref<string[]>([
  dayjs()
    .subtract(DEFAULT_RANGE_DAYS - 1, 'day')
    .format('YYYY-MM-DD'),
  dayjs().format('YYYY-MM-DD')
])

const columns = [
  { colKey: 'date', title: '日期', width: 110 },
  { colKey: 'providerName', title: '供应商', width: 130 },
  { colKey: 'publicModel', title: '对外模型' },
  { colKey: 'requestCount', title: '请求数', width: 90 },
  { colKey: 'successCount', title: '成功', width: 80 },
  { colKey: 'failCount', title: '失败', width: 80 },
  { colKey: 'promptTokens', title: '输入', width: 100 },
  { colKey: 'completionTokens', title: '输出', width: 100 },
  { colKey: 'cacheReadTokens', title: '缓存读', width: 100 },
  { colKey: 'cacheWriteTokens', title: '缓存写', width: 100 },
  { colKey: 'unrecognizedTokens', title: '无法统计', width: 100 },
  { colKey: 'totalTokens', title: '总 Tokens', width: 110 }
]

const summary = computed(() => {
  return list.value.reduce(
    (acc, item) => ({
      requestCount: acc.requestCount + item.requestCount,
      successCount: acc.successCount + item.successCount,
      failCount: acc.failCount + item.failCount,
      promptTokens: acc.promptTokens + item.promptTokens,
      completionTokens: acc.completionTokens + item.completionTokens,
      cacheTokens: acc.cacheTokens + item.cacheReadTokens + item.cacheWriteTokens,
      totalTokens: acc.totalTokens + item.totalTokens
    }),
    {
      requestCount: 0,
      successCount: 0,
      failCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheTokens: 0,
      totalTokens: 0
    }
  )
})

const cacheRatioText = computed(() => {
  const { cacheTokens, totalTokens } = summary.value
  return totalTokens > 0 ? `${((cacheTokens / totalTokens) * 100).toFixed(1)}%` : '—'
})

async function load(): Promise<void> {
  const [start, end] = range.value
  if (!start || !end) return
  loading.value = true
  try {
    list.value = await window.preload.usage.listByRange(start, end)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<style scoped lang="less">
.stat-card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
