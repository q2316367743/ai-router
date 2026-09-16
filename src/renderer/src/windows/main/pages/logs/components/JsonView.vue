<template>
  <pre class="json-view" v-html="html"></pre>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  /** JSON 文本；解析失败时按纯文本原样展示 */
  text: string | null
}>()

const html = computed<string>(() => highlight(props.text))

/** 四类 token：key / 字符串 / 数字 / 布尔与空值（字符串优先匹配，避免内部内容被二次着色） */
const TOKEN_RE =
  /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

function highlight(raw: string | null): string {
  if (!raw) return ''
  let pretty = raw
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return escapeHtml(raw)
  }
  return escapeHtml(pretty).replace(TOKEN_RE, (_match, key, str, num, keyword) => {
    if (key) return `<span class="j-key">${key}</span>`
    if (str) return `<span class="j-str">${str}</span>`
    if (num) return `<span class="j-num">${num}</span>`
    return `<span class="j-kw">${keyword}</span>`
  })
}

/** 仅转义 & < >（引号需保留供 token 正则匹配，其出现在文本节点中无注入风险） */
function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
</script>

<style lang="less" scoped>
.json-view {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  height: 400px;

  :deep(.j-key) {
    color: var(--td-brand-color);
  }
  :deep(.j-str) {
    color: var(--td-success-color);
  }
  :deep(.j-num) {
    color: var(--td-warning-color);
  }
  :deep(.j-kw) {
    color: var(--td-error-color);
  }
}
</style>
