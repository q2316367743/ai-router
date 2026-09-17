<template>
  <div class="metric-card" :style="{ '--metric-value-size': `${valueSize}px` }">
    <div class="metric-head">
      <t-icon v-if="icon" :name="icon" class="metric-icon" />
      <span class="metric-label">{{ label }}</span>
      <t-tooltip v-if="hint" :content="hint" placement="top-right">
        <t-icon name="help-circle" class="metric-hint" />
      </t-tooltip>
      <t-tag
        v-if="pillText"
        class="metric-pill"
        :theme="pillTheme"
        variant="light"
        size="small"
        shape="round"
      >
        {{ pillText }}
      </t-tag>
    </div>

    <div v-if="$slots.default" class="metric-value">
      <slot />
    </div>

    <div v-if="$slots.viz" class="metric-viz">
      <slot name="viz" />
    </div>

    <div v-if="footer" class="metric-footer">{{ footer }}</div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 看板卡片外壳（首页与托盘面板共用）：统一四段解剖 ——
 *   头部（图标 + 标签 + 状态胶囊） / 数值 / 卡内可视化 / 页脚明细。
 *
 * 只有「解剖」没有「语义」：分档色、迷你图数据、胶囊文案都由调用方决定，
 * 本组件不判断业务好坏。需要分档着色的场景由调用方在根节点挂 stat-* 类
 * （色值与渐晕在 assets/style/customer.less 统一定义）。
 *
 * 数值字号经 --metric-value-size 下传，避免为每个尺寸新建一个变体类。
 */
withDefaults(
  defineProps<{
    label: string
    /** tdesign 图标名（不手写 SVG） */
    icon?: string
    /** 状态胶囊文案；不传则不显示胶囊 */
    pillText?: string
    pillTheme?: 'default' | 'primary' | 'warning' | 'danger' | 'success'
    /** 口径说明，不传则不显示问号图标 */
    hint?: string
    /** 页脚明细，11px 次要色 */
    footer?: string
    valueSize?: number
  }>(),
  { icon: '', pillText: '', pillTheme: 'default', hint: '', footer: '', valueSize: 26 }
)
</script>

<style scoped lang="less">
/**
 * 底色用卡片面 token + 阴影：卡片比面板底更亮才是「浮起」，反过来的层级会显平。
 * --fluent-card-bg 的缺省值（0.7 白 / 0.7 的 #201f1e）在不透明容器上合成结果与原色一致，
 * 但窗口可以整体重定向它：托盘面板即把面板内的卡片指向玻璃卡片底（见 windows/tray/App.vue）。
 */
.metric-card {
  position: relative;
  padding: 14px 16px;
  border-radius: var(--fluent-radius-card);
  /* 用 background-color 而非 background 简写：简写会把分档渐晕的 background-image 重置掉 */
  background-color: var(--fluent-card-bg, var(--td-bg-color-container));
  border: 1px solid var(--fluent-card-border);
  box-shadow: var(--fluent-card-shadow);
  overflow: hidden;
}

.metric-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.metric-icon {
  font-size: 14px;
  color: var(--td-text-color-placeholder);
  flex-shrink: 0;
}

.metric-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-secondary);
}

.metric-pill {
  flex-shrink: 0;
}

.metric-hint {
  font-size: 13px;
  color: var(--td-text-color-placeholder);
  cursor: help;
  flex-shrink: 0;
}

.metric-viz {
  margin-top: 10px;
}

.metric-footer {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--td-text-color-placeholder);
}
</style>
