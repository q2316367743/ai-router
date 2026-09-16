<template>
  <t-card title="接入示例" header-bordered>
    <t-tabs v-model="active">
      <template #action>
        <t-button variant="text" size="small" theme="primary" @click="copy(activeExample)">
          <template #icon><t-icon name="file-copy" /></template>
          复制
        </t-button>
      </template>

      <t-tab-panel value="curl" label="OpenAI 兼容">
        <div class="text-13px text-td-placeholder mb-8px">
          标准 OpenAI 兼容接口，模型名填「模型映射」中定义的对外名称
        </div>
        <pre class="code-block">{{ curlExample }}</pre>
      </t-tab-panel>

      <t-tab-panel value="codex" label="Codex">
        <div class="text-13px text-td-placeholder mb-8px">
          写入 <code>~/.codex/config.toml</code>，并将环境变量
          <code>AI_ROUTER_API_KEY</code> 设为上方 API Key
        </div>
        <pre class="code-block">{{ codexExample }}</pre>
      </t-tab-panel>

      <t-tab-panel value="agent" label="通用 Agent">
        <div class="text-13px text-td-placeholder mb-8px">
          适用于任意支持 OpenAI 兼容接口的 Agent / SDK，模型名填「模型映射」中的对外名称
        </div>
        <pre class="code-block">{{ agentExample }}</pre>
      </t-tab-panel>
    </t-tabs>
  </t-card>
</template>

<script lang="ts" setup>
import { MessageUtil } from '@/utils/modal'

const props = defineProps<{
  endpoint: string
  apiKey: string
}>()

const active = ref('curl')

const curlExample = computed(
  () => `curl ${props.endpoint}/chat/completions \\
  -H "Authorization: Bearer ${props.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<对外模型名>",
    "messages": [{ "role": "user", "content": "hello" }],
    "stream": true
  }'`
)

const codexExample = computed(
  () => `model = "<对外模型名>"
model_provider = "ai-router"

[model_providers.ai-router]
name = "AI Router"
base_url = "${props.endpoint}"
env_key = "AI_ROUTER_API_KEY"
wire_api = "chat"`
)

const agentExample = computed(
  () => `export OPENAI_BASE_URL="${props.endpoint}"
export OPENAI_API_KEY="${props.apiKey}"`
)

const activeExample = computed(() => {
  if (active.value === 'codex') return codexExample.value
  if (active.value === 'agent') return agentExample.value
  return curlExample.value
})

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    MessageUtil.success('已复制')
  } catch {
    MessageUtil.error('复制失败')
  }
}
</script>

<style lang="less" scoped>
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
