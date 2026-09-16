<template>
  <PageLayout title="设置">
    <div class="p-24px max-w-760px">
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
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import { onMounted, ref, computed } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
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
</script>

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
