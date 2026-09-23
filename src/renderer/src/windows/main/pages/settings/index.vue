<template>
  <PageLayout title="设置">
    <div class="p-24px">
      <!-- 外观 -->
      <div class="card">
        <div class="font-500">外观</div>
        <div class="text-13px text-td-secondary mt-4px mb-12px">
          界面色彩模式，「跟随系统」将实时响应系统深浅色变化
        </div>
        <t-radio-group :value="mode" variant="default-filled" @change="onModeChange">
          <t-radio-button value="system">跟随系统</t-radio-button>
          <t-radio-button value="light">浅色</t-radio-button>
          <t-radio-button value="dark">深色</t-radio-button>
        </t-radio-group>
      </div>

      <!-- 看板卡片 -->
      <div class="card mt-12px">
        <div class="font-500">看板卡片</div>
        <div class="text-13px text-td-secondary mt-4px mb-12px">
          首页与托盘面板看板的卡片显示与顺序，改动立即生效并同步到另一窗口
        </div>
        <DashboardLayoutEditor />
      </div>

      <!-- 托盘额度 -->
      <div class="card mt-12px">
        <div class="font-500">托盘额度</div>
        <div class="text-13px text-td-secondary mt-4px mb-12px">
          托盘面板「额度」页展示哪些提供商、顺序与余额告警阈值；改动立即生效并同步到另一窗口
        </div>
        <TrayQuotaEditor />
      </div>

      <!-- 启动 -->
      <div class="card mt-12px">
        <div class="flex items-center justify-between gap-16px">
          <div>
            <div class="font-500">开机自启</div>
            <div class="text-13px text-td-secondary mt-4px">{{ autoLaunchHint }}</div>
          </div>
          <t-switch
            :value="autoLaunchEnabled"
            :loading="autoLaunchLoading"
            :disabled="!autoLaunchSupported"
            @change="toggleAutoLaunch"
          />
        </div>
      </div>

      <!-- 网络代理 -->
      <div class="card mt-12px">
        <div class="font-500">网络代理</div>
        <div class="text-13px text-td-secondary mt-4px mb-12px">
          上游请求经 HTTP(S) 代理转发（CONNECT 隧道），留空直连；保存后立即生效
        </div>
        <div class="flex items-center gap-8px">
          <t-input
            v-model="proxyDraft"
            class="flex-1"
            placeholder="http://127.0.0.1:7890"
            :disabled="proxySaving"
            @enter="saveProxyUrl"
          />
          <t-button
            variant="outline"
            :loading="proxySaving"
            :disabled="proxyDraft.trim() === proxyUrl"
            @click="saveProxyUrl"
          >
            保存
          </t-button>
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import { onMounted, ref, computed } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import DashboardLayoutEditor from './components/DashboardLayoutEditor.vue'
import TrayQuotaEditor from './components/TrayQuotaEditor.vue'
import { useColorMode } from '@/hooks/colorMode'
import { MessageUtil } from '@/utils/modal'

const { mode, setColorMode } = useColorMode()

function onModeChange(value: unknown): void {
  if (value === 'system' || value === 'light' || value === 'dark') {
    setColorMode(value)
  }
}

const autoLaunchSupported = ref(false)
const autoLaunchEnabled = ref(false)
const autoLaunchLoading = ref(false)

const autoLaunchHint = computed(() =>
  autoLaunchSupported.value
    ? '开机后静默驻留托盘，代理服务自动在后台运行'
    : '开发模式或当前平台不支持，安装到系统后生效'
)

onMounted(async () => {
  try {
    const state = await window.preload.app.getAutoLaunch()
    autoLaunchSupported.value = state.supported
    autoLaunchEnabled.value = state.enabled
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '读取开机自启状态失败')
  }
  try {
    const config = await window.preload.service.getConfig()
    proxyUrl.value = config.proxyUrl
    proxyDraft.value = config.proxyUrl
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '读取代理设置失败')
  }
})

async function toggleAutoLaunch(enabled: unknown): Promise<void> {
  if (autoLaunchLoading.value) return
  autoLaunchLoading.value = true
  try {
    const state = await window.preload.app.setAutoLaunch(enabled === true)
    autoLaunchSupported.value = state.supported
    autoLaunchEnabled.value = state.enabled
    MessageUtil.success(state.enabled ? '已开启开机自启' : '已关闭开机自启')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '设置失败')
  } finally {
    autoLaunchLoading.value = false
  }
}

/** 代理设置：保存走 service:saveConfig（整对象回传 + 服务重启），空串直连 */
const proxyUrl = ref('')
const proxyDraft = ref('')
const proxySaving = ref(false)

function isValidProxyUrl(raw: string): boolean {
  if (!raw) return true
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function saveProxyUrl(): Promise<void> {
  if (proxySaving.value) return
  const url = proxyDraft.value.trim()
  if (!isValidProxyUrl(url)) {
    MessageUtil.error('代理地址必须是合法的 http(s) URL')
    return
  }
  proxySaving.value = true
  try {
    const config = await window.preload.service.getConfig()
    await window.preload.service.saveConfig({ ...config, proxyUrl: url })
    proxyUrl.value = url
    proxyDraft.value = url
    MessageUtil.success('代理设置已保存并生效')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    proxySaving.value = false
  }
}
</script>

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
