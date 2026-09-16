<template>
  <PageLayout title="概览">
    <div class="p-24px">
      <!-- 系统状态：API 服务状态 + 区间成功率 -->
      <div class="status-card mb-12px">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-10px">
            <t-tag :theme="statusTheme" variant="light">{{ stateLabel }}</t-tag>
            <t-tooltip v-if="status.state === 'running'" :content="endpoint">
              <span class="text-14px font-500">{{ endpoint }}</span>
            </t-tooltip>
            <span v-else-if="status.error" class="text-13px text-td-secondary">{{
              status.error
            }}</span>
          </div>
          <div class="flex items-center gap-16px">
            <div class="text-right">
              <div class="text-11px text-td-placeholder">区间请求成功率</div>
              <div class="text-16px font-600">{{ rowSuccessText }}</div>
            </div>
            <div class="text-right">
              <div class="text-11px text-td-placeholder">区间请求数</div>
              <div class="text-16px font-600">{{ stats.overview.value.totals.requestCount }}</div>
            </div>
            <t-button variant="outline" size="small" @click="router.push('/service')"
              >服务设置</t-button
            >
          </div>
        </div>
      </div>

      <UsageDashboard :stats="stats" />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
/**
 * 首页统计看板：系统状态行（服务状态 tag + 区间成功率 / 请求数）+ 共用看板主体。
 *
 * 统计对象在本页创建（useUsageStats），同时喂给状态行与 UsageDashboard，
 * 保证两者展示的是同一次查询结果。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ServiceStatus } from '@common/types'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import UsageDashboard from '@/components/usage/UsageDashboard.vue'
import { useUsageStats } from '@/components/usage/useUsageStats'

const router = useRouter()

const status = ref<ServiceStatus>({ state: 'stopped', port: 0 })
let unsubscribe: (() => void) | null = null

const stats = useUsageStats('today')

const endpoint = computed(() => `http://127.0.0.1:${status.value.port}/v1`)

const stateLabel = computed(() => {
  if (status.value.state === 'running') return '运行中'
  if (status.value.state === 'error') return '异常'
  return '已停止'
})

const statusTheme = computed<'success' | 'danger' | 'default'>(() => {
  if (status.value.state === 'running') return 'success'
  if (status.value.state === 'error') return 'danger'
  return 'default'
})

const rowSuccessText = computed(() =>
  stats.successRate.value === null ? '—' : `${stats.successRate.value.toFixed(1)}%`
)

onMounted(() => {
  void stats.refresh()
  void window.preload.service.getConfig().then((cfg) => {
    if (status.value.port === 0) status.value = { ...status.value, port: cfg.port }
  })
  void window.preload.service.getStatus().then((next) => {
    status.value = next
  })
  unsubscribe = window.preload.service.onStatusChanged((next) => {
    status.value = next
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped lang="less">
.status-card {
  padding: 14px 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
