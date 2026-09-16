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
      <div class="text-13px text-td-secondary mb-12px">每日使用量按模型永久保留</div>
      <div class="grid grid-cols-3 gap-16px mb-16px">
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">区间请求数</div>
          <div class="text-24px font-600">{{ summary.requestCount }}</div>
        </div>
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">输入 Tokens</div>
          <div class="text-24px font-600">{{ formatTokens(summary.promptTokens) }}</div>
        </div>
        <div class="stat-card">
          <div class="text-13px text-td-secondary mb-8px">输出 Tokens</div>
          <div class="text-24px font-600">{{ formatTokens(summary.completionTokens) }}</div>
        </div>
      </div>

      <t-table
        row-key="date-model"
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
import { computed, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import type { UsageDailyItem } from '@common/types'
import { formatTokens } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'

const DEFAULT_RANGE_DAYS = 30

const list = ref<UsageDailyItem[]>([])
const loading = ref(false)
const range = ref<string[]>([
  dayjs().subtract(DEFAULT_RANGE_DAYS - 1, 'day').format('YYYY-MM-DD'),
  dayjs().format('YYYY-MM-DD')
])

const columns = [
  { colKey: 'date', title: '日期', width: 130 },
  { colKey: 'publicModel', title: '对外模型' },
  { colKey: 'requestCount', title: '请求数', width: 110 },
  { colKey: 'promptTokens', title: '输入', width: 110 },
  { colKey: 'completionTokens', title: '输出', width: 110 },
  { colKey: 'totalTokens', title: '总 Tokens', width: 120 }
]

const summary = computed(() => {
  return list.value.reduce(
    (acc, item) => ({
      requestCount: acc.requestCount + item.requestCount,
      promptTokens: acc.promptTokens + item.promptTokens,
      completionTokens: acc.completionTokens + item.completionTokens
    }),
    { requestCount: 0, promptTokens: 0, completionTokens: 0 }
  )
})

async function load(): Promise<void> {
  if (!range.value || range.value.length !== 2) return
  loading.value = true
  try {
    list.value = await window.preload.usage.listByRange(range.value[0], range.value[1])
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<style lang="less" scoped>
.stat-card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
