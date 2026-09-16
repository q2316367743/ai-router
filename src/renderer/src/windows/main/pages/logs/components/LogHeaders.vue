<template>
  <t-descriptions v-if="entries.length" :column="1" bordered size="small">
    <t-descriptions-item v-for="[name, value] in entries" :key="name" :label="name">{{ value }}</t-descriptions-item>
  </t-descriptions>
  <div v-else class="text-13px text-td-placeholder p-12px">（空）</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  /** 标头 JSON 文本（入库时已脱敏） */
  headersJson: string | null
}>()

const entries = computed<Array<[string, string]>>(() => {
  if (!props.headersJson) return []
  try {
    const parsed: unknown = JSON.parse(props.headersJson)
    if (!isRecord(parsed)) return []
    return Object.entries(parsed).map(([name, value]) => [name, String(value)])
  } catch {
    return []
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
</script>

<style lang="less" scoped>
:deep(.t-descriptions__label) {
  width: 200px;
  word-break: break-all;
}
:deep(.t-descriptions__content) {
  word-break: break-all;
}
</style>
