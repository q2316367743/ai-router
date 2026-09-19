<template>
  <PageLayout title="概览">
    <div class="p-24px">
      <!-- 系统状态：API 服务状态 + 端点（区间数值与入口由插槽补充） -->
      <ServiceStatusBar :status="status" class="mb-12px">
        <div class="text-right">
          <div class="text-11px text-td-placeholder">区间请求成功率</div>
          <div class="text-16px font-600" :class="successLevelClass">{{ rowSuccessText }}</div>
        </div>
        <div class="text-right">
          <div class="text-11px text-td-placeholder">区间请求数</div>
          <div class="text-16px font-600" :class="requestLevelClass">
            {{ stats.overview.value.totals.requestCount }}
          </div>
        </div>
        <t-button variant="outline" size="small" @click="router.push('/service')"
          >服务设置</t-button
        >
      </ServiceStatusBar>

      <UsageDashboard :stats="stats" :speed="speed" :clients="clients" surface="home" />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
/**
 * 首页统计看板：服务状态条（状态胶囊 + 端点 + 区间数值）+ 共用看板主体。
 *
 * 统计对象在本页创建（useUsageStats），同时喂给状态条右侧的数值与 UsageDashboard，
 * 保证两者展示的是同一次查询结果。两张固定近七天窗口的图（模型速度 / 来源客户端）也由本页
 * 统一取数，整页挂在同一个刷新节拍上（useRefreshSchedule），卡片退化为纯展示组件。
 *
 * 页面被 keep-alive 缓存（见 windows/main/App.vue）：切走再切回来不重建图表，节拍到点前
 * 直接复用上次数据，因此这里的组件名与 App.vue 的 include 列表是一对，改名要同步改。
 *
 * 服务状态由 useServiceStatus 订阅推送，与托盘面板同源，不参与节拍。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { UsageClientStats, UsageModelSpeed } from '@common/types'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import ServiceStatusBar from '@/components/service/ServiceStatusBar.vue'
import UsageDashboard from '@/components/usage/UsageDashboard.vue'
import {
  REQUEST_MAGNITUDE_THRESHOLDS,
  magnitudeLevel,
  successSeverity,
  useUsageStats
} from '@/components/usage/useUsageStats'
import { useServiceStatus } from '@/hooks/useServiceStatus'
import { useRefreshSchedule } from '@/hooks/useRefreshSchedule'

// 与 App.vue 的 keep-alive include 对应，改名会让页面缓存失效
defineOptions({ name: 'HomePage' })

const router = useRouter()

const status = useServiceStatus()
const stats = useUsageStats('last24h')
/** 固定近七天窗口的两张图：数据源是请求日志（含来源与速度），不随看板维度与筛选变化 */
const speed = ref<UsageModelSpeed | null>(null)
const clients = ref<UsageClientStats | null>(null)

/** 首次进入显示加载态，之后的节拍刷新静默（否则停留期间每 30 秒闪一次遮罩） */
let loaded = false

async function refreshAll(): Promise<void> {
  const silent = loaded
  await Promise.all([
    stats.refresh({ silent }),
    window.preload.usage.modelSpeed().then((next) => {
      speed.value = next
    }),
    window.preload.usage.clientStats().then((next) => {
      clients.value = next
    })
  ])
  loaded = true
}

// 进页面按「上次刷新时刻」决定立刻刷还是等剩余时长，之后每 30 秒一届拍；离开页面停表
useRefreshSchedule(refreshAll, { key: 'home' })

const rowSuccessText = computed(() =>
  stats.successRate.value === null ? '—' : `${stats.successRate.value.toFixed(1)}%`
)

// 状态行两个数字与统计卡同一口径（色相承载好坏 / 明度承载大小），类名定义在全局 customer.less。
// 注意这里统计的是「近 24 小时」，与下方看板的默认维度一致，故两处档位必然同色。
const successLevelClass = computed(() => {
  const severity = successSeverity(stats.successRate.value)
  return severity ? `stat-${severity}` : ''
})

const requestLevelClass = computed(() => {
  const level = magnitudeLevel(
    stats.overview.value.totals.requestCount,
    REQUEST_MAGNITUDE_THRESHOLDS
  )
  return `stat-mag-${level}`
})
</script>
