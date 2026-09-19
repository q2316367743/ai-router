/**
 * 看板卡片布局：首页 / 托盘面板各自独立的「显示 + 顺序」配置。
 *
 * - 配置整份缓存在模块级 ref（每窗口进程只经 IPC 读一次），注册表 × 存储合并出渲染序列；
 * - 保存走 setting 域通用通道，主进程向所有窗口广播 setting:changed，
 *   另一窗口（如主窗口保存后的托盘面板）据此重读并实时重排；
 * - 合并规则（版本升级安全）：存储里缺失的卡片（新版本新增）按注册表顺序追加并取默认可见性，
 *   多余的 id（卡片已下线）与重复项丢弃；顺序包含隐藏卡，重新打开不漂移。
 */
import { computed, ref } from 'vue'
import {
  DASHBOARD_LAYOUT_SETTING_KEY,
  type DashboardLayoutConfig,
  type DashboardLayoutItem,
  type DashboardSurface
} from '@common/types'
import { DASHBOARD_CARDS } from './cardRegistry'
import type { DashboardCardDef } from './cardTypes'

/** 渲染序列中的一项：注册表定义 + 用户可见性 */
export interface ResolvedDashboardCard {
  def: DashboardCardDef
  visible: boolean
}

// ---- 模块级配置缓存（每窗口进程一份，主窗口与托盘互不相干、靠广播同步） ----

const config = ref<DashboardLayoutConfig>({})

function isLayoutItem(value: unknown): value is DashboardLayoutItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'visible' in value &&
    typeof value.visible === 'boolean'
  )
}

function isLayoutItems(value: unknown): value is DashboardLayoutItem[] {
  return Array.isArray(value) && value.every((item) => isLayoutItem(item))
}

function isLayoutConfig(value: unknown): value is DashboardLayoutConfig {
  if (typeof value !== 'object' || value === null) return false
  for (const surface of ['home', 'tray'] as const) {
    if (surface in value && value[surface] !== undefined && !isLayoutItems(value[surface])) {
      return false
    }
  }
  return true
}

let ensurePromise: Promise<void> | null = null

/**
 * 惰性加载配置（失败含脏数据按空配置回退默认布局，不阻塞看板渲染）。
 * 编辑器场景必须显式 await：配置未落地时读到的默认顺序一旦保存会覆盖用户布局。
 */
export function ensureLayoutLoaded(): Promise<void> {
  ensurePromise ??= window.preload.setting
    .get(DASHBOARD_LAYOUT_SETTING_KEY)
    .then((raw) => {
      if (isLayoutConfig(raw)) config.value = raw
    })
    .catch(() => undefined)
  return ensurePromise
}

let subscribed = false

/** 订阅跨窗口变更广播（每窗口进程一次），另一窗口保存后实时重读 */
function subscribeChanged(): void {
  if (subscribed) return
  subscribed = true
  window.preload.setting.onSettingChanged((key) => {
    if (key !== DASHBOARD_LAYOUT_SETTING_KEY) return
    void window.preload.setting
      .get(DASHBOARD_LAYOUT_SETTING_KEY)
      .then((raw) => {
        if (isLayoutConfig(raw)) config.value = raw
      })
      .catch(() => undefined)
  })
}

// ---- 合并与读写 ----

/** 某界面注册表内的全部卡片（抽屉清单与默认布局共用） */
export function surfaceCards(surface: DashboardSurface): DashboardCardDef[] {
  return DASHBOARD_CARDS.filter((def) => def.surfaces.includes(surface))
}

/**
 * 注册表 × 存储配置合并出渲染序列（纯函数）：
 * 按存储顺序取已注册卡片，缺失的（新增卡）按注册表顺序追加，未知 / 重复 id 丢弃。
 */
export function resolveCards(
  surface: DashboardSurface,
  stored: DashboardLayoutItem[] | undefined
): ResolvedDashboardCard[] {
  const defs = surfaceCards(surface)
  const byId = new Map(defs.map((def) => [def.id, def]))
  const resolved: ResolvedDashboardCard[] = []
  const consumed = new Set<string>()
  for (const item of stored ?? []) {
    const def = byId.get(item.id)
    if (!def || consumed.has(item.id)) continue
    resolved.push({ def, visible: item.visible })
    consumed.add(item.id)
  }
  for (const def of defs) {
    if (!consumed.has(def.id)) resolved.push({ def, visible: def.defaultVisible })
  }
  return resolved
}

/** 某界面的默认布局（注册表顺序 + 默认可见性），供「恢复默认」重置工作副本 */
export function defaultLayoutItems(surface: DashboardSurface): DashboardLayoutItem[] {
  return surfaceCards(surface).map((def) => ({ id: def.id, visible: def.defaultVisible }))
}

/** 当前生效的布局（配置抽屉初始化工作副本用；未加载完时为 undefined，resolveCards 回退默认） */
export function currentLayoutItems(surface: DashboardSurface): DashboardLayoutItem[] | undefined {
  return config.value[surface]
}

/** 保存某界面布局：本地立即生效，持久化后由 setting:changed 广播驱动其它窗口同步 */
export async function saveDashboardLayout(
  surface: DashboardSurface,
  items: DashboardLayoutItem[]
): Promise<void> {
  config.value = { ...config.value, [surface]: items }
  await window.preload.setting.set(DASHBOARD_LAYOUT_SETTING_KEY, config.value)
}

/**
 * 看板主体用：返回某界面按配置合并后的卡片序列。
 * 配置未加载完成时先按注册表默认渲染（本地 SQLite 毫秒级读取，无感知差异）。
 */
export function useDashboardLayout(surface: DashboardSurface) {
  void ensureLayoutLoaded()
  subscribeChanged()
  const cards = computed(() => resolveCards(surface, config.value[surface]))
  return { cards }
}
