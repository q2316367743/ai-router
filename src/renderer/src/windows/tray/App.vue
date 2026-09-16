<template>
  <div class="panel">
    <!-- 面板头：拖拽区 + 收起 / 打开主窗口 -->
    <div class="panel-header">
      <span class="text-13px font-600">用量统计</span>
      <div class="flex items-center gap-2px no-drag">
        <t-button variant="text" shape="square" size="small" @click="openMain">
          <template #icon><t-icon name="app" /></template>
        </t-button>
        <t-button variant="text" shape="square" size="small" @click="hide">
          <template #icon><t-icon name="close" /></template>
        </t-button>
      </div>
    </div>

    <div class="panel-body">
      <UsageDashboard
        :stats="stats"
        :ranges="['last24h', 'last7d', 'last30d']"
        :show-filters="false"
        compact
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 托盘统计面板：窄面板（400px）内的用量看板。
 *
 * - 维度只提供 近24小时 / 近七天 / 近30天（「今天」在托盘上与 24 小时高度重合，故不提供）。
 * - 供应商趋势图在 24 小时维度下按供应商分线（对应「24 小时 token 趋势，分为每个供应商的」）。
 * - 面板自身不显示筛选（窄面板放不下），筛选入口在主窗口首页。
 */
import { onMounted, onUnmounted } from 'vue'
import { useUsageStats } from '@/components/usage/useUsageStats'
import UsageDashboard from '@/components/usage/UsageDashboard.vue'
import { useColorMode } from '@/hooks/colorMode'

// 初始化主题（含与主窗口的 localStorage 同步）；托盘面板必须显式调用以应用当前深浅色
useColorMode()

const stats = useUsageStats('last24h')

function hide(): void {
  void window.preload.tray.hide()
}

function openMain(): void {
  void window.preload.tray.openMain().then(() => window.preload.tray.hide())
}

/** 主进程每次弹出面板时推送 tray:shown，据此刷新（面板隐藏期间数据可能过期） */
let unsubscribe: (() => void) | null = null

onMounted(() => {
  void stats.refresh()
  unsubscribe = window.preload.tray.onShown(() => void stats.refresh())
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped lang="less">
/**
 * 面板外层用 --fluent-acrylic-bg 做半透明底，配合主进程 vibrancy / acrylic 生效。
 */
.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  color: var(--td-text-color-primary);
  background: var(--fluent-acrylic-bg, var(--td-bg-color-container));
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px 0 14px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--fluent-border-subtle);
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
</style>
