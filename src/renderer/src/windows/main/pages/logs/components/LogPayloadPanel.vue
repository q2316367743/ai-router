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
        <pre v-else-if="body" class="raw-block">{{ body }}</pre>
        <div v-else class="text-13px text-td-placeholder p-12px">（空）</div>
      </template>
      <LogHeaders v-else :headers-json="headersJson" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import JsonView from './JsonView.vue'
import LogHeaders from './LogHeaders.vue'

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
  border: 1px solid var(--fluent-border-subtle);
  border-radius: 6px;
  background: var(--td-bg-color-component);
  max-height: 360px;
  overflow-y: auto;
}

.raw-block {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
