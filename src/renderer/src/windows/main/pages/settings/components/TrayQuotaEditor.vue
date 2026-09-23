<template>
  <div>
    <div v-if="rows.length === 0" class="quota-empty">
      还没有绑定余量策略的提供商，可先在「余量」页查看策略目录，再到提供商编辑抽屉中绑定。
    </div>

    <template v-else>
      <div ref="listRef" class="quota-list">
        <div v-for="row in rows" :key="row.providerId" class="quota-row">
          <t-icon name="drag-move" class="drag-handle" />
          <div class="quota-main">
            <span class="quota-name" :class="{ 'is-hidden': !row.visible }">{{ row.name }}</span>
            <t-tag v-if="row.strategyLabel" variant="outline" size="small">
              {{ row.strategyLabel }}
            </t-tag>
            <t-tag v-if="!row.enabled" theme="warning" variant="light" size="small">已停用</t-tag>
          </div>
          <t-switch v-model="row.visible" size="small" @change="saveItems" />
        </div>
      </div>

      <t-button variant="text" size="small" class="mt-4px" @click="reset">恢复默认顺序</t-button>
    </template>

    <div class="quota-threshold">
      <span class="quota-threshold__label">余额告警阈值</span>
      <t-input-number
        v-model="thresholdDraft"
        :min="0"
        :step="1"
        size="small"
        theme="normal"
        style="width: 120px"
        @change="onThresholdChange"
      />
    </div>
    <div class="quota-threshold__hint">
      余额低于该值时卡片转告警色（按快照原币种数值比较，¥10 与 $10 视为同一数值口径）
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 托盘额度配置（设置页「托盘额度」卡内容）：展示哪些已绑定余量策略的提供商、顺序、告警阈值。
 *
 * 与看板卡片编辑器同构：**即改即存**（saveTrayQuotaConfig 落库并广播，托盘面板实时重排），
 * 因此没有「保存」按钮；拖拽用 sortablejs（handle 限定把手，onEnd 把 DOM 顺序同步回数组，
 * 配合 :key 使 Vue 补丁为空操作）。
 *
 * 行数据以 providerId 为键：提供商名可改、可重名，不能当键（改名后这里展示新名字、顺序不乱）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Sortable from 'sortablejs'
import type { ProviderQuotaInfo, TrayQuotaConfig } from '@common/types'
import { DEFAULT_BALANCE_ALERT_THRESHOLD } from '@common/types'
import {
  ensureTrayQuotaConfigLoaded,
  resolveTrayQuotaItems,
  saveTrayQuotaConfig,
  trayQuotaThreshold
} from '@/hooks/useTrayQuota'
import { MessageUtil } from '@/utils/modal'

/** 工作副本的行模型：提供商元信息 + 可见性 */
interface QuotaRow {
  providerId: string
  name: string
  strategyLabel: string | null
  enabled: boolean
  visible: boolean
}

const rows = ref<QuotaRow[]>([])
/** 已绑定余量策略的提供商（quota:list 已过滤未绑定与已归档），「恢复默认顺序」按此顺序 */
const providers = ref<ProviderQuotaInfo[]>([])
const thresholdDraft = ref<number>(DEFAULT_BALANCE_ALERT_THRESHOLD)
const listRef = ref<HTMLElement | null>(null)

function rowOf(provider: ProviderQuotaInfo, visible: boolean): QuotaRow {
  return {
    providerId: provider.providerId,
    name: provider.providerName,
    strategyLabel: provider.strategyLabel,
    enabled: provider.enabled,
    visible
  }
}

function itemPatch(): TrayQuotaConfig {
  return { items: rows.value.map((row) => ({ providerId: row.providerId, visible: row.visible })) }
}

async function persist(patch: TrayQuotaConfig): Promise<void> {
  try {
    await saveTrayQuotaConfig(patch)
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存托盘额度配置失败')
  }
}

function saveItems(): void {
  void persist(itemPatch())
}

/** 恢复默认：按提供商列表顺序（= 余量页顺序）+ 全部可见 + 阈值回缺省 */
function reset(): void {
  rows.value = providers.value.map((provider) => rowOf(provider, true))
  thresholdDraft.value = DEFAULT_BALANCE_ALERT_THRESHOLD
  void persist({ ...itemPatch(), balanceAlertThreshold: DEFAULT_BALANCE_ALERT_THRESHOLD })
  MessageUtil.success('已恢复默认顺序')
}

/** 输入过程中不落库（每次按键都写库会触发全窗口广播），失焦 / 回车 / 步进才保存 */
function onThresholdChange(value: unknown, context: { type: string }): void {
  if (context.type === 'input') return
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return
  void persist({ balanceAlertThreshold: next })
}

let sortable: Sortable | null = null

onMounted(async () => {
  // 配置经 IPC 惰性加载，先等它落地再进编辑模型，防止用默认顺序覆盖用户配置
  await ensureTrayQuotaConfigLoaded()
  thresholdDraft.value = trayQuotaThreshold()
  try {
    providers.value = await window.preload.quota.list()
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '读取余量提供商失败')
    return
  }
  const byId = new Map(providers.value.map((provider) => [provider.providerId, provider]))
  rows.value = resolveTrayQuotaItems(providers.value)
    .map((item) => {
      const provider = byId.get(item.providerId)
      return provider ? rowOf(provider, item.visible) : null
    })
    .filter((row): row is QuotaRow => row !== null)

  if (!listRef.value) return
  sortable = new Sortable(listRef.value, {
    handle: '.drag-handle',
    animation: 150,
    onEnd(event) {
      const { oldIndex, newIndex } = event
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const [moved] = rows.value.splice(oldIndex, 1)
      if (moved) rows.value.splice(newIndex, 0, moved)
      saveItems()
    }
  })
})

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<style scoped lang="less">
.quota-empty {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.quota-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quota-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--fluent-radius-card);
  /* 设置卡底已是 secondarycontainer，行用更亮的 container 才有「浮起」层级（同看板卡片行） */
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--fluent-border-subtle);
}

.quota-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.drag-handle {
  font-size: 16px;
  color: var(--td-text-color-placeholder);
  cursor: grab;
}

.quota-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-hidden {
    color: var(--td-text-color-placeholder);
  }
}

.quota-threshold {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.quota-threshold__label {
  font-size: 13px;
  color: var(--td-text-color-primary);
}

.quota-threshold__hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}
</style>
