<template>
  <div class="status-bar">
    <div class="status-main">
      <t-tag :theme="meta.theme" variant="light" size="small" shape="round">{{ meta.label }}</t-tag>
      <t-tooltip v-if="endpoint" :content="endpoint">
        <span class="status-endpoint">{{ endpoint }}</span>
      </t-tooltip>
      <span v-else-if="status.error" class="status-error">{{ status.error }}</span>
    </div>

    <div v-if="$slots.default" class="status-extra">
      <slot />
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 服务状态条：状态胶囊 + 监听端点，右侧留插槽给调用方补充内容。
 *
 * 供首页使用（插槽里放区间数值与服务设置入口）；托盘面板只取状态胶囊放进标题栏，
 * 不显示端点。状态数据由调用方经 useServiceStatus 获取，本组件只负责呈现，
 * 状态 → 文案 / 主题的映射在 serviceStatusMeta。
 */
import { computed } from 'vue'
import type { ServiceStatus } from '@common/types'
import { serviceStatusMeta } from '@/hooks/useServiceStatus'

const props = defineProps<{ status: ServiceStatus }>()

const meta = computed(() => serviceStatusMeta(props.status))

/** 仅在运行中展示端点：未启动时端口无意义 */
const endpoint = computed(() =>
  props.status.state === 'running' ? `http://127.0.0.1:${props.status.port}/v1` : ''
)
</script>

<style scoped lang="less">
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}

.status-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.status-endpoint {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-error {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.status-extra {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}
</style>
