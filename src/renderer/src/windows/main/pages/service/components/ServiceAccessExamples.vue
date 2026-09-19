<template>
  <div class="card">
    <div class="flex items-center justify-between gap-16px mb-12px">
      <div class="font-500">接入示例</div>
      <t-radio-group :value="active" variant="default-filled" @change="onTabChange">
        <t-radio-button v-for="tab in tabs" :key="tab.value" :value="tab.value">
          {{ tab.label }}
        </t-radio-button>
      </t-radio-group>
    </div>

    <div class="text-12px text-td-placeholder mb-12px">
      模型名使用「模型映射」页定义的对外名称，<code>GET {{ endpoint }}/models</code>
      可查询对外模型列表
    </div>

    <template v-if="current">
      <div class="flex items-center gap-8px mb-4px">
        <span class="method-chip">POST</span>
        <code class="text-13px">{{ current.path }}</code>
      </div>
      <div class="flex items-center gap-8px flex-wrap mb-12px">
        <span class="text-13px text-td-secondary">Base URL</span>
        <code class="text-13px">{{ current.baseUrl }}</code>
        <t-tooltip content="复制 Base URL">
          <t-button variant="text" shape="square" size="small" @click="onCopy(current.baseUrl)">
            <template #icon><t-icon name="file-copy" /></template>
          </t-button>
        </t-tooltip>
        <span class="text-12px text-td-placeholder">{{ current.baseUrlNote }}</span>
      </div>

      <div v-for="snippet in current.snippets" :key="snippet.label" class="mb-12px last:mb-0">
        <div class="flex items-center justify-between mb-6px">
          <span class="text-13px font-500">{{ snippet.label }}</span>
          <t-button variant="text" size="small" theme="primary" @click="onCopy(snippet.code)">
            <template #icon><t-icon name="file-copy" /></template>
            复制
          </t-button>
        </div>
        <pre class="code-block">{{ snippet.code }}</pre>
        <div v-if="snippet.note" class="text-12px text-td-placeholder mt-4px">{{ snippet.note }}</div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { copyText } from '@/utils/clipboard'

interface Snippet {
  label: string
  code: string
  note?: string
}

interface ProtocolTab {
  value: string
  label: string
  path: string
  /** 各协议客户端实际应填的 Base URL（Anthropic 不带 /v1） */
  baseUrl: string
  baseUrlNote: string
  snippets: Snippet[]
}

const props = defineProps<{
  endpoint: string
  apiKey: string
}>()

const active = ref('openai-chat')

/** 三个协议入口各一栏；代码片段数据驱动，卷入当前 endpoint / apiKey */
const tabs = computed<ProtocolTab[]>(() => {
  const endpoint = props.endpoint
  const root = endpoint.replace(/\/v1$/, '')
  const key = props.apiKey
  return [
    {
      value: 'openai-chat',
      label: 'OpenAI Chat',
      path: '/v1/chat/completions',
      baseUrl: endpoint,
      baseUrlNote: 'OpenAI SDK 与多数 GUI 客户端填此地址',
      snippets: [
        {
          label: 'cURL',
          code: `curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<对外模型名>",
    "messages": [{ "role": "user", "content": "hello" }],
    "stream": true
  }'`
        },
        {
          label: '环境变量（OpenAI SDK / 通用 Agent）',
          code: `export OPENAI_BASE_URL="${endpoint}"
export OPENAI_API_KEY="${key}"`
        }
      ]
    },
    {
      value: 'anthropic',
      label: 'Anthropic Messages',
      path: '/v1/messages',
      baseUrl: root,
      baseUrlNote: 'Anthropic SDK 的 Base URL 不带 /v1，SDK 会自动拼接 /v1/messages',
      snippets: [
        {
          label: 'cURL',
          code: `curl ${root}/v1/messages \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<对外模型名>",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "hello" }]
  }'`
        },
        {
          label: 'Claude Code',
          code: `export ANTHROPIC_BASE_URL="${root}"
export ANTHROPIC_AUTH_TOKEN="${key}"`
        }
      ]
    },
    {
      value: 'openai-responses',
      label: 'OpenAI Responses',
      path: '/v1/responses',
      baseUrl: endpoint,
      baseUrlNote: 'Codex CLI 等使用 Responses API 的客户端填此地址',
      snippets: [
        {
          label: 'cURL',
          code: `curl ${endpoint}/responses \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<对外模型名>",
    "input": "hello"
  }'`
        },
        {
          label: 'Codex（~/.codex/config.toml）',
          code: `model = "<对外模型名>"
model_provider = "ai-router"

[model_providers.ai-router]
name = "AI Router"
base_url = "${endpoint}"
env_key = "AI_ROUTER_API_KEY"
wire_api = "responses"`,
          note: '需将环境变量 AI_ROUTER_API_KEY 设为上方 API Key'
        }
      ]
    }
  ]
})

const current = computed(() => tabs.value.find((tab) => tab.value === active.value))

function onTabChange(value: unknown): void {
  if (typeof value === 'string') active.value = value
}

function onCopy(text: string): void {
  void copyText(text)
}
</script>

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.method-chip {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
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
