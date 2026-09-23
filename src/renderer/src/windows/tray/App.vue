<template>
  <div class="panel">
    <!-- 面板头：用量统计 / 额度 分段切换 + 运行状态胶囊 + 打开主窗口 -->
    <div class="panel-header">
      <div class="no-drag">
        <t-radio-group v-model="tab" class="fluent-segmented" variant="default-filled" size="small">
          <t-radio-button value="usage">用量统计</t-radio-button>
          <t-radio-button value="quota">额度</t-radio-button>
        </t-radio-group>
      </div>
      <div class="flex items-center gap-2px no-drag">
        <t-tag :theme="statusMeta.theme" variant="light" size="small" shape="round">
          {{ statusMeta.label }}
        </t-tag>
        <t-button variant="text" shape="square" size="small" @click="openMain">
          <template #icon>
            <app-icon />
          </template>
        </t-button>
      </div>
    </div>

    <div class="panel-body">
      <!-- 用量统计为兜底页：localStorage 里的值异常时不会露出空白 -->
      <UsageDashboard
        v-if="tab !== 'quota'"
        :stats="stats"
        :show-filters="false"
        surface="tray"
        compact
      />
      <TrayQuotaPanel v-else />
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 托盘面板：标题栏切换「用量统计」与「额度」两页（选择记在 localStorage，与主窗口同源）。
 *
 * - 用量页：维度走 UsageDashboard 的默认候选（今天 / 近24小时 / 近七天 / 近30天，默认近 24 小时），
 *   供应商趋势图在 24 小时维度下按供应商分线；面板自身不显示筛选（窄面板放不下），筛选入口在主窗口首页。
 * - 额度页：各提供商余量快照，顺序与开关在设置页「托盘额度」配置（见 docs/app/14）。
 * - 两页用 v-if 切换而非 v-show：额度页的补查只在真正切到该页时发生（面板一创建就跑会白白出站），
 *   也避开 echarts 在 display:none 下尺寸为 0 的问题。
 * - 服务状态只以胶囊形式放在标题栏（复用 useServiceStatus 与首页同源），不显示端点。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { AppIcon } from 'tdesign-icons-vue-next'
import { useUsageStats } from '@/components/usage/useUsageStats'
import UsageDashboard from '@/components/usage/UsageDashboard.vue'
import { useColorMode } from '@/hooks/colorMode'
import { serviceStatusMeta, useServiceStatus } from '@/hooks/useServiceStatus'
import TrayQuotaPanel from './components/TrayQuotaPanel.vue'

type TrayTab = 'usage' | 'quota'

// 初始化主题（含与主窗口的 localStorage 同步）；托盘面板必须显式调用以应用当前深浅色
useColorMode()

const tab = useLocalStorage<TrayTab>('tray.tab', 'usage')
const stats = useUsageStats('last24h')
const status = useServiceStatus()
const statusMeta = computed(() => serviceStatusMeta(status.value))

function openMain(): void {
  void window.preload.tray.openMain().then(() => window.preload.tray.hide())
}

/** 主进程每次弹出面板时推送 tray:shown，据此刷新（面板隐藏期间数据可能过期）；
 *  额度页自己订阅同一条推送，这里只管用量统计 */
let unsubscribe: (() => void) | null = null

onMounted(() => {
  void stats.refresh()
  unsubscribe = window.preload.tray.onShown(() => {
    if (tab.value !== 'quota') void stats.refresh()
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped lang="less">
/**
 * 面板外层用 --fluent-acrylic-bg 做半透明底，配合主进程 vibrancy / acrylic 生效。
 *
 * 面板作用域内重定向表面 token（CSS 变量随 DOM 继承到面板里所有看板卡片，不泄漏到主窗口）：
 * - --fluent-card-bg → 玻璃卡片底：卡片也是半透明，面板的亚克力才透得上来；
 * - --metric-tint-alpha：分档渐晕是不透明色阶，跟着降透明度才不在卡片角落糊出实色块。
 */
.panel {
  --fluent-card-bg: var(--fluent-acrylic-card-bg);
  --metric-tint-alpha: 60%;
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
  padding: 0 8px 0 10px;
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
