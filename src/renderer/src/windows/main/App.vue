<template>
  <t-layout class="main">
    <!-- 拖拽区为 fixed 覆盖层（不占布局），页面 header 透过 z-index 摆放操作按钮 -->
    <div class="window-drag-region"></div>

    <!-- 侧边栏：顶部留出 macOS 交通灯区域，可收起 -->
    <t-aside :width="collapsed ? '76px' : '220px'" class="sidebar">
      <div class="traffic-light-holder"></div>
      <t-menu
        :value="active"
        class="sidebar-menu"
        style="width: 100%"
        :collapsed="collapsed"
        @change="onMenuChange"
      >
        <t-menu-item v-for="item in menus" :key="item.value" :value="item.value">
          <template #icon><t-icon :name="item.icon" /></template>
          {{ item.label }}
        </t-menu-item>
      </t-menu>
    </t-aside>

    <!-- 内容区：浮于页面背景之上的圆角卡片（Fluent Design 层级） -->
    <t-content class="main-container">
      <!-- 只缓存概览页：它是唯一「进页就重建整套图表」的重页面，缓存后切回来不复用空态、直接显示上次数据；
           日志页的推送订阅与轮询依赖卸载收尾，不缓存 -->
      <router-view v-slot="{ Component }">
        <keep-alive :include="['HomePage']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </t-content>

    <!-- 折叠按钮：悬浮于标题区左侧（macOS 让出交通灯），穿透拖拽层 -->
    <div class="common-operator" :style="{ left: `${l1}px` }">
      <t-button theme="default" shape="square" variant="text" @click="toggleCollapsed()">
        <template #icon><t-icon name="view-list" /></template>
      </t-button>
    </div>
  </t-layout>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { collapsed, toggleCollapsed } from '@/global/collapsed'
import { useColorMode } from '@/hooks/colorMode'
import { useTitlePadding } from '@/hooks/useTitlePadding'

interface MenuItem {
  value: string
  label: string
  icon: string
}

const menus: MenuItem[] = [
  { value: '/home', label: '概览', icon: 'dashboard' },
  { value: '/providers', label: '提供商', icon: 'cloud' },
  { value: '/models', label: '模型映射', icon: 'link' },
  { value: '/service', label: '服务', icon: 'server' },
  { value: '/logs', label: '日志', icon: 'history' },
  { value: '/usage', label: '用量统计', icon: 'chart-bar' },
  { value: '/settings', label: '设置', icon: 'setting' }
]

const route = useRoute()
const router = useRouter()

/** 取路径首段作为激活菜单（如 /providers/x → /providers） */
const active = computed(() => `/${route.path.split('/')[1] ?? ''}`)

const onMenuChange = (value: unknown): void => {
  void router.push(String(value))
}

// 主题初始化（首帧前渲染）；切换入口在「设置」页
useColorMode()

const { l1 } = useTitlePadding()
</script>

<style scoped lang="less">
.main {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: row;
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-page);
  user-select: unset !important;
}

.sidebar {
  z-index: 50;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100vh;
  overflow: hidden;
  transition: width 0.2s ease-in-out;
}

/** macOS 交通灯（trafficLightPosition y=17）避让区 */
.traffic-light-holder {
  height: 32px;
  flex-shrink: 0;
}

.sidebar-menu {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.main-container {
  position: relative;
  height: 100vh;
  width: 100%;
  background-color: var(--td-bg-color-container);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}

.window-drag-region {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  z-index: 52;
  -webkit-app-region: drag;
}

.common-operator {
  position: fixed;
  top: 8px;
  z-index: 60;
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}
</style>
