<template>
  <PageLayout title="概览">
    <div class="p-24px">
      <div class="grid grid-cols-2 gap-16px">
        <!-- 服务状态 -->
        <div class="stat-card col-span-2">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-td-secondary text-13px mb-8px">本地服务</div>
              <div class="flex items-center gap-8px">
                <t-tag :theme="statusTheme" variant="light">{{ stateLabel }}</t-tag>
                <t-tooltip v-if="status.state === 'running'" :content="endpoint">
                  <span class="text-14px font-500">{{ endpoint }}</span>
                </t-tooltip>
                <span v-else-if="status.error" class="text-13px text-td-secondary">{{ status.error }}</span>
              </div>
            </div>
            <t-button variant="outline" size="small" @click="router.push('/service')">服务设置</t-button>
          </div>
        </div>

        <!-- 今日统计 -->
        <div class="stat-card">
          <div class="text-td-secondary text-13px mb-8px">今日请求</div>
          <div class="text-28px font-600">{{ stats.requestCount }}</div>
        </div>
        <div class="stat-card">
          <div class="text-td-secondary text-13px mb-8px">今日 Tokens</div>
          <div class="text-28px font-600">{{ formatTokens(stats.totalTokens) }}</div>
          <div class="text-12px text-td-placeholder mt-4px">
            输入 {{ formatTokens(stats.promptTokens) }} · 输出 {{ formatTokens(stats.completionTokens) }}
          </div>
        </div>

        <!-- 配置规模 -->
        <div class="stat-card">
          <div class="text-td-secondary text-13px mb-8px">提供商</div>
          <div class="text-28px font-600">{{ providerEnabled }}<span class="text-14px text-td-placeholder"> / {{ providerTotal }}</span></div>
          <div class="text-12px text-td-placeholder mt-4px">启用中 / 总数</div>
        </div>
        <div class="stat-card">
          <div class="text-td-secondary text-13px mb-8px">对外模型</div>
          <div class="text-28px font-600">{{ modelEnabled }}<span class="text-14px text-td-placeholder"> / {{ modelTotal }}</span></div>
          <div class="text-12px text-td-placeholder mt-4px">启用中 / 总数</div>
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ServiceStatus, TodayStats } from '@common/types'
import { formatTokens } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'

const router = useRouter()

const status = ref<ServiceStatus>({ state: 'stopped', port: 0 })
const stats = ref<TodayStats>({ requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 })
const providerTotal = ref(0)
const providerEnabled = ref(0)
const modelTotal = ref(0)
const modelEnabled = ref(0)

let unsubscribe: (() => void) | null = null

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

async function refresh(): Promise<void> {
  const [s, providers, models] = await Promise.all([
    window.preload.log.todayStats(),
    window.preload.provider.list(),
    window.preload.model.list()
  ])
  stats.value = s
  providerTotal.value = providers.length
  providerEnabled.value = providers.filter((p) => p.enabled).length
  modelTotal.value = models.length
  modelEnabled.value = models.filter((m) => m.enabled).length
}

onMounted(() => {
  void refresh()
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

<style lang="less" scoped>
.stat-card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
