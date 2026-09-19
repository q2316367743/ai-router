<template>
  <div>
    <!-- 首页 / 托盘面板各存一份布局，分段切换编辑对象 -->
    <t-radio-group
      :value="surface"
      variant="default-filled"
      size="small"
      @change="onSurfaceChange"
    >
      <t-radio-button value="home">首页</t-radio-button>
      <t-radio-button value="tray">托盘面板</t-radio-button>
    </t-radio-group>

    <div ref="listRef" class="card-list">
      <div v-for="item in items" :key="item.id" class="card-row">
        <t-icon name="drag-move" class="drag-handle" />
        <t-icon :name="item.icon" class="card-icon" />
        <span class="card-title" :class="{ 'is-hidden': !item.visible }">{{ item.title }}</span>
        <t-switch v-model="item.visible" size="small" @change="save" />
      </div>
    </div>

    <t-button variant="text" size="small" class="mt-4px" @click="reset">恢复默认</t-button>
  </div>
</template>

<script lang="ts" setup>
/**
 * 看板卡片布局编辑器（设置页「看板卡片」卡内容）：首页 / 托盘面板各一份「显示 + 顺序」配置。
 *
 * 看板本身是纯展示面（头部不放编辑入口），配置统一收在此处；改动**即改即存**
 * （saveDashboardLayout 落库并广播，另一窗口实时同步），因此切换「首页 / 托盘面板」
 * 不存在未保存草稿，直接重读该界面的生效布局即可。拖拽用 sortablejs（handle 限定
 * 拖拽把手，onEnd 把 DOM 顺序同步回数组，配合 :key 使 Vue 补丁为空操作）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Sortable from 'sortablejs'
import type { DashboardSurface } from '@common/types'
import type { DashboardCardDef } from '@/components/usage/cardTypes'
import {
  currentLayoutItems,
  defaultLayoutItems,
  ensureLayoutLoaded,
  resolveCards,
  saveDashboardLayout,
  surfaceCards
} from '@/components/usage/useDashboardLayout'
import { MessageUtil } from '@/utils/modal'

/** 工作副本的行模型：注册表元数据 + 可见性 */
interface LayoutRow {
  id: string
  title: string
  icon: string
  visible: boolean
}

const surface = ref<DashboardSurface>('home')
const items = ref<LayoutRow[]>([])
const listRef = ref<HTMLElement | null>(null)

function onSurfaceChange(value: unknown): void {
  if (value === 'home' || value === 'tray') surface.value = value
}

function rowOf(def: DashboardCardDef, visible: boolean): LayoutRow {
  return { id: def.id, title: def.title, icon: def.icon, visible }
}

/** 读当前生效布局作为编辑模型（切换界面 / 初始加载共用） */
function load(): void {
  items.value = resolveCards(surface.value, currentLayoutItems(surface.value)).map(({ def, visible }) =>
    rowOf(def, visible)
  )
}

function save(): void {
  saveDashboardLayout(
    surface.value,
    items.value.map((row) => ({ id: row.id, visible: row.visible }))
  ).catch((err: unknown) => MessageUtil.error(err instanceof Error ? err.message : '保存布局失败'))
}

/** 恢复当前界面为注册表默认布局（即改即存） */
function reset(): void {
  const defaults = new Map(defaultLayoutItems(surface.value).map((item) => [item.id, item.visible]))
  items.value = surfaceCards(surface.value).map((def) => rowOf(def, defaults.get(def.id) ?? true))
  save()
  MessageUtil.success('已恢复默认布局')
}

let sortable: Sortable | null = null

onMounted(async () => {
  // 布局配置经 IPC 惰性加载，先等它落地再进编辑模型，防止用默认顺序覆盖用户配置
  await ensureLayoutLoaded()
  load()
  if (!listRef.value) return
  sortable = new Sortable(listRef.value, {
    handle: '.drag-handle',
    animation: 150,
    onEnd(event) {
      const { oldIndex, newIndex } = event
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const [moved] = items.value.splice(oldIndex, 1)
      if (moved) items.value.splice(newIndex, 0, moved)
      save()
    }
  })
})

watch(surface, load)

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<style scoped lang="less">
.card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--fluent-radius-card);
  /* 设置卡底已是 secondarycontainer，行用更亮的 container 才有「浮起」层级（见 docs/app/09） */
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--fluent-border-subtle);
}

.drag-handle {
  font-size: 16px;
  color: var(--td-text-color-placeholder);
  cursor: grab;
}

.card-icon {
  font-size: 16px;
  color: var(--td-text-color-secondary);
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--td-text-color-primary);

  &.is-hidden {
    color: var(--td-text-color-placeholder);
  }
}
</style>
