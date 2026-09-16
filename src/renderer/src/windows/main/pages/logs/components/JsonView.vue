<template>
  <CodeViewer :value="display.value" :language="display.language" height="100%" />
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import CodeViewer from './CodeViewer.vue'

/** 超过该长度的文本跳过 JSON 美化，直接以纯文本渲染，避免主线程卡顿 */
const MAX_PRETTY_LENGTH = 512 * 1024

interface Display {
  value: string | null
  language: 'json' | 'plaintext'
}

const props = defineProps<{
  /** JSON 文本；解析失败时按纯文本原样展示 */
  text: string | null
}>()

const display = computed<Display>(() => {
  const raw = props.text
  if (!raw) return { value: null, language: 'plaintext' }
  if (raw.length > MAX_PRETTY_LENGTH) return { value: raw, language: 'plaintext' }
  try {
    return { value: JSON.stringify(JSON.parse(raw), null, 2), language: 'json' }
  } catch {
    return { value: raw, language: 'plaintext' }
  }
})
</script>
