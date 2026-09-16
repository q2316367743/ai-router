<template>
  <div class="flex flex-col min-w-0 h-400px">
    <div class="flex items-center justify-between mb-8px">
      <span class="font-500">{{ title }}</span>
      <t-radio-group :value="mode" variant="outline" size="small" @change="onModeChange">
        <t-radio-button value="body">正文</t-radio-button>
        <t-radio-button value="headers">标头</t-radio-button>
      </t-radio-group>
    </div>
    <div class="display-area">
      <template v-if="mode === 'body'">
        <JsonView v-if="showJsonView" :text="body" />
        <CodeViewer v-else :value="body" language="plaintext" height="100%" />
      </template>
      <div v-else class="headers-scroll">
        <LogHeaders :headers-json="headersJson" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import JsonView from './JsonView.vue'
import LogHeaders from './LogHeaders.vue'
import CodeViewer from './CodeViewer.vue'

type PanelMode = 'body' | 'headers'

const props = defineProps<{
  title: string
  body: string | null
  headersJson: string | null
  /** 流式响应正文为纯文本 SSE 流，其余按 JSON 视图展示 */
  stream: boolean
}>()

const mode = ref<PanelMode>('body')
const showJsonView = computed(() => !props.stream)

function onModeChange(value: string | number | boolean): void {
  if (value === 'body' || value === 'headers') mode.value = value
}
</script>

<style lang="less" scoped>
.display-area {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--fluent-border-subtle);
  border-radius: 6px;
  background: var(--td-bg-color-component);
  overflow: hidden;
}

.headers-scroll {
  height: 100%;
  overflow-y: auto;
}
</style>
