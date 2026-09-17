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

      <UsageDashboard :stats="stats" show-speed />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
/**
 * 首页统计看板：服务状态条（状态胶囊 + 端点 + 区间数值）+ 共用看板主体。
 *
 * 统计对象在本页创建（useUsageStats），同时喂给状态条右侧的数值与 UsageDashboard，
 * 保证两者展示的是同一次查询结果。服务状态由 useServiceStatus 订阅，与托盘面板同源。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()

const status = useServiceStatus()
const stats = useUsageStats('last24h')

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

onMounted(() => {
  void stats.refresh()
})
</script>
