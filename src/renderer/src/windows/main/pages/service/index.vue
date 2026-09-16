<template>
  <PageLayout title="服务">
    <div class="p-24px">
      <!-- 服务开关 -->
      <div class="card mb-12px">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-500">启用本地服务</div>
            <div class="text-13px text-td-secondary mt-4px">{{ stateHint }}</div>
          </div>
          <t-switch :value="config.enabled" :loading="switching" @change="toggleEnabled" />
        </div>
      </div>

      <!-- 监听端口 -->
      <div class="card mb-12px">
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
      </div>

      <!-- API Key -->
      <div class="card mb-12px">
        <div class="font-500 mb-8px">对外 API Key</div>
        <div class="flex items-center gap-8px">
          <code class="text-13px break-all">{{ displayKey }}</code>
        </div>
        <div class="flex items-center gap-4px mt-8px">
          <t-button variant="outline" size="small" @click="showKey = !showKey">
            <template #icon><t-icon :name="showKey ? 'browse' : 'browse-off'" /></template>
            {{ showKey ? '隐藏' : '显示' }}
          </t-button>
          <t-button variant="outline" size="small" @click="copyKey">
            <template #icon><t-icon name="file-copy" /></template>
            复制
          </t-button>
          <t-popconfirm content="重新生成后旧 Key 立即失效，确定？" @confirm="regenerate">
            <t-button variant="outline" size="small" theme="danger">重新生成</t-button>
          </t-popconfirm>
        </div>
      </div>

      <!-- 接入示例 -->
      <div class="card">
        <div class="flex items-center justify-between mb-8px">
          <div class="font-500">接入示例（OpenAI 兼容）</div>
          <t-button variant="text" size="small" theme="primary" @click="copyExample">
            <template #icon><t-icon name="file-copy" /></template>
            复制
          </t-button>
        </div>
        <pre class="code-block">{{ example }}</pre>
        <div class="text-13px text-td-placeholder mt-8px">
          客户端 Base URL 填 {{ endpoint }}，模型名使用「模型映射」中定义的对外名称
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { ServiceConfig, ServiceStatus } from '@common/types'
import { maskKey } from '@/utils/format'
import PageLayout from '@/components/PageLayout/PageLayout.vue'

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

const example = computed(
  () => `curl ${endpoint.value}/chat/completions \\
  -H "Authorization: Bearer ${config.value.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<对外模型名>",
    "messages": [{ "role": "user", "content": "hello" }],
    "stream": true
  }'`
)

async function toggleEnabled(enabled: unknown): Promise<void> {
  switching.value = true
  try {
    status.value = await window.preload.service.saveConfig({
      ...config.value,
      enabled: enabled === true
    })
    config.value.enabled = enabled === true
    MessagePlugin.success(enabled === true ? '服务已开启' : '服务已关闭')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '操作失败')
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
    MessagePlugin.success('端口已保存，服务已重启')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    savingPort.value = false
  }
}

async function copyKey(): Promise<void> {
  try {
    await navigator.clipboard.writeText(config.value.apiKey)
    MessagePlugin.success('已复制')
  } catch {
    MessagePlugin.error('复制失败')
  }
}

async function regenerate(): Promise<void> {
  try {
    config.value.apiKey = await window.preload.service.regenerateKey()
    showKey.value = true
    MessagePlugin.success('已重新生成')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function copyExample(): Promise<void> {
  try {
    await navigator.clipboard.writeText(example.value)
    MessagePlugin.success('已复制')
  } catch {
    MessagePlugin.error('复制失败')
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

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.code-block {
  margin: 0;
  padding: 12px;
  border-radius: var(--fluent-radius-smooth);
  background: var(--td-bg-color-container);
  border: 1px solid var(--fluent-border-subtle);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}
</style>
