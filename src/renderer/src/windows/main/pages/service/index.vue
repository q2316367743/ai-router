<template>
  <PageLayout title="服务">
    <div class="p-24px">
      <!-- 服务配置 -->
      <t-card title="服务配置" header-bordered class="mb-12px">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-500">启用本地服务</div>
            <div class="text-13px text-td-secondary mt-4px">{{ stateHint }}</div>
          </div>
          <t-switch :value="config.enabled" :loading="switching" @change="toggleEnabled" />
        </div>

        <t-divider />

        <div class="font-500 mb-8px">监听端口</div>
        <div class="flex items-center gap-8px">
          <t-input-number
            v-model="portDraft"
            :min="1"
            :max="65535"
            :step="1"
            style="width: 140px"
          />
          <t-button
            variant="outline"
            :disabled="portDraft === config.port"
            :loading="savingPort"
            @click="savePort"
          >
            保存并重启
          </t-button>
        </div>
        <div class="text-13px text-td-placeholder mt-8px">
          仅监听 127.0.0.1，修改端口后服务自动重启
        </div>
      </t-card>

      <!-- 对接信息 -->
      <t-card title="对接信息" header-bordered class="mb-12px">
        <div class="font-500 mb-8px">对外 API Key</div>
        <div class="mb-12px">
          <code class="text-13px break-all">{{ displayKey }}</code>
        </div>
        <div class="flex items-center gap-8px">
          <t-button variant="outline" size="small" @click="showKey = !showKey">
            <template #icon><t-icon :name="showKey ? 'browse' : 'browse-off'" /></template>
            {{ showKey ? '隐藏' : '显示' }}
          </t-button>
          <t-button variant="outline" size="small" @click="copyText(config.apiKey)">
            <template #icon><t-icon name="file-copy" /></template>
            复制
          </t-button>
          <t-popconfirm content="重新生成后旧 Key 立即失效，确定？" @confirm="regenerate">
            <t-button variant="outline" size="small" theme="danger">重新生成</t-button>
          </t-popconfirm>
        </div>

        <t-divider />

        <div class="font-500 mb-8px">接入端点</div>
        <div class="flex items-center gap-4px">
          <code class="text-13px break-all">{{ endpoint }}</code>
          <t-button variant="text" shape="square" size="small" @click="copyText(endpoint)">
            <template #icon><t-icon name="file-copy" /></template>
          </t-button>
        </div>
        <div class="text-13px text-td-placeholder mt-8px">
          客户端 Base URL 填此项，模型名使用「模型映射」中定义的对外名称
        </div>
      </t-card>

      <!-- 接入示例 -->
      <ServiceAccessExamples :endpoint="endpoint" :api-key="config.apiKey" />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ServiceConfig, ServiceStatus } from '@common/types'
import { maskKey } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import ServiceAccessExamples from './components/ServiceAccessExamples.vue'
import { MessageUtil } from '@/utils/modal'

const config = ref<ServiceConfig>({ port: 8910, apiKey: '', enabled: false })
const status = ref<ServiceStatus>({ state: 'stopped', port: 0 })
const portDraft = ref(8910)
const showKey = ref(false)
const switching = ref(false)
const savingPort = ref(false)

let unsubscribe: (() => void) | null = null

const endpoint = computed(() => `http://127.0.0.1:${config.value.port}/v1`)

const stateHint = computed(() => {
  if (status.value.state === 'running') return `运行中 · ${endpoint.value}`
  if (status.value.state === 'error') return `异常：${status.value.error ?? '未知错误'}`
  return config.value.enabled ? '已停止' : '关闭后客户端将无法访问'
})

const displayKey = computed(() =>
  showKey.value ? config.value.apiKey : maskKey(config.value.apiKey)
)

async function toggleEnabled(enabled: unknown): Promise<void> {
  switching.value = true
  try {
    status.value = await window.preload.service.saveConfig({
      ...config.value,
      enabled: enabled === true
    })
    config.value.enabled = enabled === true
    MessageUtil.success(enabled === true ? '服务已开启' : '服务已关闭')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    switching.value = false
  }
}

async function savePort(): Promise<void> {
  savingPort.value = true
  try {
    status.value = await window.preload.service.saveConfig({
      ...config.value,
      port: portDraft.value
    })
    config.value.port = portDraft.value
    MessageUtil.success('端口已保存，服务已重启')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    savingPort.value = false
  }
}

async function copyText(text: string): Promise<void> {
  if (!text) {
    MessageUtil.error('暂无可复制内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    MessageUtil.success('已复制')
  } catch {
    MessageUtil.error('复制失败')
  }
}

async function regenerate(): Promise<void> {
  try {
    config.value.apiKey = await window.preload.service.regenerateKey()
    showKey.value = true
    MessageUtil.success('已重新生成')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
}

onMounted(() => {
  void window.preload.service.getConfig().then((cfg) => {
    config.value = cfg
    portDraft.value = cfg.port
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
