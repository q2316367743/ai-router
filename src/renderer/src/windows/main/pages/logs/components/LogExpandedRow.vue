<template>
  <t-loading :loading="loading" show-overlay>
    <t-card size="small">
      <template v-if="log" #header>
        <div class="flex items-center gap-8px">
          <t-tag v-if="isPendingStatus(log.status)" theme="primary" size="small">进行中</t-tag>
          <t-tag v-else :theme="isSuccessStatus(log.status) ? 'success' : 'danger'" size="small"
            >HTTP {{ log.status }}</t-tag
          >
          <t-tag variant="outline" size="small">POST</t-tag>
          <span class="mono text-13px">{{ log.path }}</span>
        </div>
      </template>
      <template v-if="log">
        <t-alert
          v-if="isPendingStatus(log.status)"
          theme="info"
          style="margin-bottom: 12px"
          message="请求进行中：状态码、耗时与 token 用量将在响应结束后回填"
        />
        <t-descriptions :column="4" bordered size="small">
          <t-descriptions-item label="持续时间">{{
            formatDuration(log.durationMs)
          }}</t-descriptions-item>
          <t-descriptions-item label="流式">{{ log.stream ? '是' : '否' }}</t-descriptions-item>
          <t-descriptions-item label="请求 ID" :span="2">
            <span class="mono text-12px">{{ log.requestId }}</span>
          </t-descriptions-item>
          <t-descriptions-item label="请求模型">{{ log.publicModel }}</t-descriptions-item>
          <t-descriptions-item label="来源">{{ log.client ?? '未知' }}</t-descriptions-item>
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
          <t-descriptions-item label="总计 Tokens" :span="3">{{
            formatTokens(log.totalTokens)
          }}</t-descriptions-item>
        </t-descriptions>

        <!-- 正文已超保留期：行、标头与统计信息仍在，只有正文被 main 侧按窗口清空 -->
        <t-alert
          v-if="bodyExpired"
          theme="info"
          style="margin-top: 16px"
          :message="`请求 / 响应正文仅保留最近 ${LOG_BODY_RETENTION_HOURS} 小时，更早的记录只剩标头与统计信息`"
        />

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
          <CodeViewer :value="log.error" language="plaintext" height="200px" />
        </template>
      </template>
      <div v-else-if="!loading" class="text-13px text-td-placeholder">（日志不存在或已被清理）</div>
    </t-card>
  </t-loading>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import type { RequestLogDetail } from '@common/types'
import { LOG_BODY_RETENTION_HOURS } from '@common/constants'
import { formatDuration, formatTokens, isPendingStatus, isSuccessStatus } from '@/utils/format'
import LogPayloadPanel from './LogPayloadPanel.vue'
import CodeViewer from './CodeViewer.vue'

const props = defineProps<{
  id: number
  /** 是否为进行中的请求（详情尚未回填；展开期间请求结束需重新拉取） */
  pending?: boolean
}>()

const loading = ref(true)
const log = ref<RequestLogDetail | null>(null)

/**
 * 正文已超保留期：已结束且两侧正文全空 —— 正文在结束阶段就已回填，正常请求不会为空；
 * 未结束的行正文在 pending 阶段就落库，故排除 finishedAt 为 null 的行。
 */
const bodyExpired = computed(
  () =>
    !!log.value &&
    log.value.finishedAt !== null &&
    !log.value.requestBody &&
    !log.value.responseBody
)

async function reload(): Promise<void> {
  loading.value = true
  try {
    log.value = await window.preload.log.getDetail(props.id)
  } finally {
    loading.value = false
  }
}

onMounted(() => void reload())

// 展开期间请求结束 → 行状态由进行中变为已完成，重新拉取详情以显示回填结果
watch(
  () => props.pending,
  (pending, wasPending) => {
    if (wasPending && !pending) void reload()
  }
)
</script>

<style lang="less" scoped>
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
