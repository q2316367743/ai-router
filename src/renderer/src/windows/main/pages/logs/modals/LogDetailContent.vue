<template>
  <div>
    <t-descriptions :column="2" bordered size="small">
      <t-descriptions-item label="时间">{{ formatDateTime(log.createdAt) }}</t-descriptions-item>
      <t-descriptions-item label="耗时">{{ log.durationMs }}ms</t-descriptions-item>
      <t-descriptions-item label="状态">
        <t-tag :theme="statusTheme(log.status)" variant="light" size="small">{{ log.status }}</t-tag>
      </t-descriptions-item>
      <t-descriptions-item label="响应类型">{{ log.stream ? '流式（SSE）' : '非流式' }}</t-descriptions-item>
      <t-descriptions-item label="对外模型">{{ log.publicModel }}</t-descriptions-item>
      <t-descriptions-item label="提供商">{{ log.providerName }}</t-descriptions-item>
      <t-descriptions-item label="上游模型">{{ log.upstreamModel }}</t-descriptions-item>
      <t-descriptions-item label="请求路径">{{ log.path }}</t-descriptions-item>
      <t-descriptions-item label="输入 Tokens">{{ log.promptTokens }}</t-descriptions-item>
      <t-descriptions-item label="输出 Tokens">{{ log.completionTokens }}</t-descriptions-item>
      <t-descriptions-item label="总 Tokens" :span="2">{{ log.totalTokens }}</t-descriptions-item>
    </t-descriptions>

    <template v-if="log.error">
      <div class="font-500 mt-16px mb-8px">错误信息</div>
      <pre class="error-block">{{ log.error }}</pre>
    </template>

    <div class="flex justify-end mt-16px">
      <t-button variant="outline" @click="emit('close')">关闭</t-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import type { RequestLogItem } from '@common/types'
import { statusTheme } from '@/utils/format'

defineProps<{
  log: RequestLogItem
}>()

const emit = defineEmits<{
  close: []
}>()

function formatDateTime(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD HH:mm:ss')
}
</script>

<style lang="less" scoped>
.error-block {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: var(--td-bg-color-component);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
</style>
