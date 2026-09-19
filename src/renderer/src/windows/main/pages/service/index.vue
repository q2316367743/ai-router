<template>
  <PageLayout title="服务">
    <div class="p-24px">
      <!-- 连接：状态 + Base URL + API Key + 端口，接入最常用的信息集中在一张卡 -->
      <div class="card">
        <div class="flex items-center justify-between gap-16px">
          <div class="flex items-center gap-10px min-w-0">
            <span class="status-dot" :class="`status-dot--${statusMeta.tone}`" />
            <div class="min-w-0">
              <div class="font-500">{{ statusMeta.label }}</div>
              <div class="text-13px text-td-secondary mt-2px truncate">{{ statusMeta.desc }}</div>
            </div>
          </div>
          <div class="flex items-center gap-8px shrink-0">
            <span class="text-13px text-td-secondary">启用服务</span>
            <t-switch :value="config.enabled" :loading="switching" @change="toggleEnabled" />
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">Base URL</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-8px">
              <t-input :value="endpoint" readonly class="flex-1 font-mono" />
              <t-tooltip content="复制 Base URL">
                <t-button variant="outline" shape="square" @click="onCopy(endpoint)">
                  <template #icon><t-icon name="file-copy" /></template>
                </t-button>
              </t-tooltip>
            </div>
            <div class="field-tip">
              OpenAI 系客户端填此地址；Anthropic 系客户端填不带 /v1 的地址，见下方接入示例
            </div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">API Key</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-8px">
              <t-input :value="displayKey" readonly class="flex-1 font-mono" />
              <t-tooltip :content="showKey ? '隐藏' : '显示'">
                <t-button variant="outline" shape="square" @click="showKey = !showKey">
                  <template #icon><t-icon :name="showKey ? 'browse' : 'browse-off'" /></template>
                </t-button>
              </t-tooltip>
              <t-tooltip content="复制">
                <t-button variant="outline" shape="square" @click="onCopy(config.apiKey)">
                  <template #icon><t-icon name="file-copy" /></template>
                </t-button>
              </t-tooltip>
              <t-popconfirm content="重新生成后旧 Key 立即失效，确定？" @confirm="regenerate">
                <t-button variant="outline" theme="danger">重新生成</t-button>
              </t-popconfirm>
            </div>
            <div class="field-tip">所有协议共用；鉴权同时支持 Authorization: Bearer 与 x-api-key</div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-label">监听端口</div>
          <div class="flex-1 min-w-0">
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
            <div class="field-tip">仅监听 127.0.0.1，修改端口后服务自动重启</div>
          </div>
        </div>
      </div>

      <!-- 接入示例：按对外协议分栏 -->
      <ServiceAccessExamples class="mt-12px" :endpoint="endpoint" :api-key="config.apiKey" />
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ServiceConfig, ServiceStatus } from '@common/types'
import { maskKey } from '@/utils/format'
import { copyText } from '@/utils/clipboard'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import ServiceAccessExamples from './components/ServiceAccessExamples.vue'
import { MessageUtil } from '@/utils/modal'

const config = ref<ServiceConfig>({ port: 8910, apiKey: '', enabled: false, proxyUrl: '' })
const status = ref<ServiceStatus>({ state: 'stopped', port: 0 })
const portDraft = ref(8910)
const showKey = ref(false)
const switching = ref(false)
const savingPort = ref(false)

let unsubscribe: (() => void) | null = null

const endpoint = computed(() => `http://127.0.0.1:${config.value.port}/v1`)

/** 状态行四态：运行 / 异常 / 已启用未就绪 / 已关闭；色值取各主题下可读的色阶 */
const statusMeta = computed<{ tone: 'running' | 'error' | 'wait' | 'off'; label: string; desc: string }>(
  () => {
    if (status.value.state === 'running')
      return {
        tone: 'running',
        label: '服务运行中',
        desc: `127.0.0.1:${status.value.port} 监听中`
      }
    if (status.value.state === 'error')
      return { tone: 'error', label: '服务异常', desc: status.value.error ?? '未知错误' }
    if (config.value.enabled)
      return { tone: 'wait', label: '服务已停止', desc: '等待服务启动…' }
    return { tone: 'off', label: '服务已关闭', desc: '开启后客户端才能接入' }
  }
)

const displayKey = computed(() =>
  showKey.value ? config.value.apiKey : maskKey(config.value.apiKey)
)

function onCopy(text: string): void {
  void copyText(text)
}

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

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

/* 行间发丝线分隔，替代 t-divider，保持紧凑的凭据表观感 */
.field-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--fluent-border-subtle);
}

.field-label {
  flex-shrink: 0;
  width: 76px;
  font-weight: 500;
  line-height: 32px;
}

.field-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--td-text-color-placeholder);
}

.status-dot {
  --dot-color: var(--td-text-color-placeholder);
  position: relative;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot-color);

  &--running {
    --dot-color: var(--td-success-color-5);
  }
  &--error {
    --dot-color: var(--td-error-color-5);
  }
  &--wait {
    --dot-color: var(--td-warning-color-6);
  }

  /* 运行中的呼吸光环：Fluent 式轻动效，只动 transform / opacity */
  &--running::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 1px solid var(--dot-color);
    animation: service-pulse 2.4s ease-out infinite;
  }
}

:root[theme-mode='dark'] {
  .status-dot--running {
    --dot-color: var(--td-success-color-8);
  }
  .status-dot--error {
    --dot-color: var(--td-error-color-7);
  }
  .status-dot--wait {
    --dot-color: var(--td-warning-color-8);
  }
}

@keyframes service-pulse {
  0% {
    transform: scale(0.5);
    opacity: 0.8;
  }
  70%,
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}
</style>
