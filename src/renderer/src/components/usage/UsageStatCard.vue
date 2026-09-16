<template>
  <div class="stat-card">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value" :style="{ fontSize: `${valueSize}px` }">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
    <div v-if="tone" class="stat-accent" :class="`tone-${tone}`"></div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 统计小卡（首页 / 托盘面板共用）：替代此前在多个页面重复粘贴的 .stat-card 样式。
 * value 由调用方格式化（token 用 formatTokens，比例用百分比），组件只管排版与语义色条。
 */
withDefaults(
  defineProps<{
    label: string
    value: string
    hint?: string
    valueSize?: number
    /** 左侧语义色条（可选）：brand / success / warning / danger */
    tone?: 'brand' | 'success' | 'warning' | 'danger'
  }>(),
  { valueSize: 22, hint: '', tone: undefined }
)
</script>

<style scoped lang="less">
.stat-card {
  position: relative;
  padding: 12px 14px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
  overflow: hidden;
}

.stat-label {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  margin-bottom: 6px;
}

.stat-value {
  font-weight: 600;
  color: var(--td-text-color-primary);
  line-height: 1.2;
}

.stat-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
}

/** 语义色条贴在卡片左缘，深浅色下都随 token 变化 */
.stat-accent {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
}

.tone-brand {
  background: var(--td-brand-color);
}

.tone-success {
  background: var(--td-success-color);
}

.tone-warning {
  background: var(--td-warning-color);
}

.tone-danger {
  background: var(--td-error-color);
}
</style>
