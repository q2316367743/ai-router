<template>
  <div class="chain">
    <div class="chain__row">
      <div class="chain__root" :title="group.publicName">{{ group.publicName }}</div>
      <div class="chain__branches">
        <div v-for="branch in group.branches" :key="branch.id" class="chain__branch">
          <ChannelHealthTag :info="branch.info" />
          <span class="chain__share">占 {{ Math.round(branch.share * 100) }}%</span>
          <span class="chain__node">
            <span class="chain__provider">{{ branch.providerName }}</span>
            <span class="chain__upstream">· {{ branch.upstreamName }}</span>
          </span>
          <t-button
            v-if="needsReset(branch)"
            variant="text"
            size="small"
            theme="warning"
            @click="reset(branch)"
            >重置</t-button
          >
        </div>
      </div>
    </div>

    <div v-if="group.allBlocked" class="chain__note chain__note--danger">
      全部渠道额度耗尽，该模型的请求会直接返回 503
    </div>
    <div v-else-if="group.excludedCount > 0" class="chain__note">
      另有 {{ group.excludedCount }} 个渠道已停用 / 归档，不参与分流
    </div>
  </div>
</template>

<script lang="ts" setup>
import ChannelHealthTag from './ChannelHealthTag.vue'
import type { ModelChainBranch, ModelChainGroup } from '../useModelChains'
import { MessageUtil } from '@/utils/modal'

/**
 * 单条链路：对外模型名（分叉点）→ 各渠道（支线），支线上标可用度与推算占比。
 *
 * 折线用 DOM + CSS 画（红线禁止手写 SVG）：每行支线自己画一段竖线与横线，首行的竖线从行中心起、
 * 末行的竖线到行中心止，于是竖线正好从第一支中心贯通到最后支中心；主干到分叉点那 14px 横线
 * 挂在容器 50% 高度上——**等分行高是这套几何成立的前提**，故支线内容一律单行不换行。
 *
 * 不标「首选渠道」：引擎每次请求都按权重重掷顺序，没有稳定的首位，标了就是假的。
 */
defineProps<{ group: ModelChainGroup }>()

const emit = defineEmits<{ refresh: [] }>()

/** 非正常状态才给「重置」入口（与渠道表同一条件）：充值 / 修好 Key 后的逃生口 */
function needsReset(branch: ModelChainBranch): boolean {
  return !!branch.info && branch.info.state !== 'healthy'
}

async function reset(branch: ModelChainBranch): Promise<void> {
  try {
    await window.preload.balancer.reset(branch.providerId)
    MessageUtil.success('已重置可用度')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '操作失败')
  }
  emit('refresh')
}
</script>

<style scoped lang="less">
.chain {
  /* 根节点宽度与分叉区缩进：脚注靠这两个值对齐支线内容 */
  --chain-root-width: 200px;
  --chain-gap: 28px;
  --chain-line: var(--fluent-border-subtle);

  display: flex;
  flex-direction: column;
}

.chain__row {
  display: flex;
  align-items: stretch;
}

.chain__root {
  flex: 0 0 var(--chain-root-width);
  align-self: center; /* 与分叉竖线的中点对齐 */
  overflow: hidden;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chain__branches {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-left: var(--chain-gap);
}

/* 主干 → 分叉点：等分行高下容器 50% 即竖线中点 */
.chain__branches::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  width: 14px;
  height: 1px;
  background: var(--chain-line);
}

.chain__branch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  min-width: 0;
  white-space: nowrap;
}

/* 分叉竖线：整行高，首行从中心起、末行到中心止（单渠道组高度为 0，退化成一条直线） */
.chain__branch::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -14px;
  width: 1px;
  background: var(--chain-line);
}

.chain__branch:first-child::before {
  top: 50%;
}

.chain__branch:last-child::before {
  bottom: 50%;
}

/* 分叉横线：从竖线接到支线内容 */
.chain__branch::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -14px;
  width: 14px;
  height: 1px;
  background: var(--chain-line);
}

.chain__share {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.chain__node {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain__upstream {
  margin-left: 4px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.chain__note {
  margin-top: 4px;
  margin-left: calc(var(--chain-root-width) + var(--chain-gap));
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.chain__note--danger {
  color: var(--td-error-color);
}
</style>
