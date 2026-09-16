<template>
  <t-loading :loading="loading" show-overlay>
    <t-card size="small">
      <template v-if="log" #header>
        <div class="flex items-center gap-8px">
          <t-tag :theme="isSuccessStatus(log.status) ? 'success' : 'danger'" size="small"
            >HTTP {{ log.status }}</t-tag
          >
          <t-tag variant="outline" size="small">POST</t-tag>
          <span class="mono text-13px">{{ log.path }}</span>
        </div>
      </template>
      <template v-if="log">
        <t-descriptions :column="4" bordered size="small">
          <t-descriptions-item label="持续时间">{{
            formatDuration(log.durationMs)
          }}</t-descriptions-item>
          <t-descriptions-item label="流式">{{ log.stream ? '是' : '否' }}</t-descriptions-item>
          <t-descriptions-item label="请求 ID" :span="2">
            <span class="mono text-12px">{{ log.requestId }}</span>
          </t-descriptions-item>
          <t-descriptions-item label="客户端">{{ log.publicModel }}</t-descriptions-item>
          <t-descriptions-item label="供应商">{{ log.providerName }}</t-descriptions-item>
          <t-descriptions-item label="实际模型">{{ log.upstreamModel }}</t-descriptions-item>
          <t-descriptions-item label="输入 Tokens">{{
            formatTokens(log.promptTokens)
          }}</t-descriptions-item>
          <t-descriptions-item label="输出 Tokens">{{
            formatTokens(log.completionTokens)
          }}</t-descriptions-item>
          <t-descriptions-item label="思考 Tokens">{{
            formatTokens(log.reasoningTokens)
          }}</t-descriptions-item>
          <t-descriptions-item label="缓存读取">{{
            formatTokens(log.cacheReadTokens)
          }}</t-descriptions-item>
          <t-descriptions-item label="缓存写入">{{
            formatTokens(log.cacheWriteTokens)
          }}</t-descriptions-item>
          <t-descriptions-item label="总计 Tokens">{{
            formatTokens(log.totalTokens)
          }}</t-descriptions-item>
        </t-descriptions>

        <div class="grid grid-cols-2 gap-16px mt-16px">
          <LogPayloadPanel
            title="请求"
            :body="log.requestBody"
            :headers-json="log.requestHeaders"
            :stream="false"
          />
          <LogPayloadPanel
            title="响应"
            :body="log.responseBody"
            :headers-json="log.responseHeaders"
            :stream="log.stream"
          />
        </div>

        <template v-if="log.error">
          <div class="font-500 mt-16px mb-8px">错误信息</div>
          <pre class="raw-block">{{ log.error }}</pre>
        </template>
      </template>
      <div v-else-if="!loading" class="text-13px text-td-placeholder">（日志不存在或已被清理）</div>
    </t-card>
  </t-loading>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import type { RequestLogDetail } from '@common/types'
import { formatDuration, formatTokens, isSuccessStatus } from '@/utils/format'
import LogPayloadPanel from './LogPayloadPanel.vue'

const props = defineProps<{
  id: number
}>()

const loading = ref(true)
const log = ref<RequestLogDetail | null>(null)

onMounted(async () => {
  try {
    log.value = await window.preload.log.getDetail(props.id)
  } finally {
    loading.value = false
  }
})
</script>

<style lang="less" scoped>
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}

.raw-block {
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
