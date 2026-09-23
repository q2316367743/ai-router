/**
 * 托盘额度面板：配置层 + 数据层。
 *
 * 配置（顺序 / 展示开关 / 余额告警阈值）存 settings 键 tray.quota，走 setting 域通用通道；
 * 模块级缓存 + setting:changed 广播同步 —— 主窗口设置页保存后，常驻的托盘面板实时重排。
 * 合并规则与看板卡片同构（版本升级 / 数据变化安全）：存储顺序优先、新出现的提供商按入参
 * 顺序追加且默认可见、未知 id（提供商已归档）与重复项丢弃。
 *
 * 数据层读的是 quota.list()（读库不出站）；仅对「从未查到结果」的项做一次补查，
 * 且每窗口会话每个提供商最多补一次（失败也不反复出站，错误经条目的 error 字段呈现）。
 */
import { ref, type Ref } from 'vue'
import {
  DEFAULT_BALANCE_ALERT_THRESHOLD,
  TRAY_QUOTA_SETTING_KEY,
  type ProviderQuotaInfo,
  type TrayQuotaConfig,
  type TrayQuotaItem
} from '@common/types'

// ---- 配置层 ----

const config = ref<TrayQuotaConfig>({})

function isTrayQuotaItem(value: unknown): value is TrayQuotaItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'providerId' in value &&
    typeof value.providerId === 'string' &&
    'visible' in value &&
    typeof value.visible === 'boolean'
  )
}

function isTrayQuotaConfig(value: unknown): value is TrayQuotaConfig {
  if (typeof value !== 'object' || value === null) return false
  if ('items' in value && value.items !== undefined) {
    if (!Array.isArray(value.items) || !value.items.every(isTrayQuotaItem)) return false
  }
  if ('balanceAlertThreshold' in value && value.balanceAlertThreshold !== undefined) {
    if (typeof value.balanceAlertThreshold !== 'number') return false
    if (!Number.isFinite(value.balanceAlertThreshold)) return false
  }
  return true
}

let ensurePromise: Promise<void> | null = null

/** 惰性加载配置（脏数据按空配置回退默认）；编辑器场景必须显式 await，否则会用默认值覆盖用户配置 */
export function ensureTrayQuotaConfigLoaded(): Promise<void> {
  ensurePromise ??= window.preload.setting
    .get(TRAY_QUOTA_SETTING_KEY)
    .then((raw) => {
      if (isTrayQuotaConfig(raw)) config.value = raw
    })
    .catch(() => undefined)
  return ensurePromise
}

let subscribed = false

/** 订阅跨窗口变更广播（每窗口进程一次） */
function subscribeChanged(): void {
  if (subscribed) return
  subscribed = true
  window.preload.setting.onSettingChanged((key) => {
    if (key !== TRAY_QUOTA_SETTING_KEY) return
    void window.preload.setting
      .get(TRAY_QUOTA_SETTING_KEY)
      .then((raw) => {
        if (isTrayQuotaConfig(raw)) config.value = raw
      })
      .catch(() => undefined)
  })
}

/** 存储配置 × 当前已绑定策略的提供商，合并出展示序列（含隐藏项，隐藏项保留位置） */
export function resolveTrayQuotaItems(providers: ProviderQuotaInfo[]): TrayQuotaItem[] {
  const known = new Set(providers.map((provider) => provider.providerId))
  const resolved: TrayQuotaItem[] = []
  const consumed = new Set<string>()
  for (const item of config.value.items ?? []) {
    if (!known.has(item.providerId) || consumed.has(item.providerId)) continue
    resolved.push(item)
    consumed.add(item.providerId)
  }
  for (const provider of providers) {
    if (!consumed.has(provider.providerId)) {
      resolved.push({ providerId: provider.providerId, visible: true })
    }
  }
  return resolved
}

/** 当前生效的展示序列（编辑器初始化工作副本用） */
export function currentTrayQuotaItems(): TrayQuotaItem[] {
  return config.value.items ?? []
}

/** 余额告警阈值（缺省 10） */
export function trayQuotaThreshold(): number {
  const value = config.value.balanceAlertThreshold
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_BALANCE_ALERT_THRESHOLD
}

/** 保存配置片段：本地立即生效，落库后由 setting:changed 广播驱动其它窗口同步 */
export async function saveTrayQuotaConfig(patch: TrayQuotaConfig): Promise<void> {
  config.value = { ...config.value, ...patch }
  await window.preload.setting.set(TRAY_QUOTA_SETTING_KEY, config.value)
}

/** 面板与设置页编辑器共用：订阅广播并暴露当前配置（配置未加载完也能先按默认渲染） */
export function useTrayQuotaConfig(): { config: Ref<TrayQuotaConfig> } {
  void ensureTrayQuotaConfigLoaded()
  subscribeChanged()
  return { config }
}

// ---- 数据层 ----

/** 本窗口会话内已补查过的提供商（面板窗口常驻，切页不重置，避免反复出站） */
const replenished = new Set<string>()

export interface UseQuotaListResult {
  list: Ref<ProviderQuotaInfo[]>
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  /** 读库渲染（不出站），随后对从未查到结果的项补一轮查询 */
  load: () => Promise<void>
  /** 全量出站刷新（手动按钮） */
  refreshAll: () => Promise<void>
}

export function useQuotaList(): UseQuotaListResult {
  const list = ref<ProviderQuotaInfo[]>([])
  const loading = ref(false)
  const refreshing = ref(false)

  async function load(): Promise<void> {
    loading.value = list.value.length === 0
    try {
      list.value = await window.preload.quota.list()
    } finally {
      loading.value = false
    }
    // 调度器 10 分钟一轮、启动首刷又可能早于本次查看：「从未查到结果」的项补一轮，
    // 避免一直停在「等待首次查询」；停用的提供商不参与查询，跳过
    for (const item of list.value) {
      if (item.queriedAt !== null || !item.enabled || replenished.has(item.providerId)) continue
      replenished.add(item.providerId)
      try {
        list.value = await window.preload.quota.refresh(item.providerId)
      } catch {
        // 单个提供商失败不打断其余补查，失败原因经列表条目的 error 字段呈现
      }
    }
  }

  async function refreshAll(): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    try {
      list.value = await window.preload.quota.refresh()
    } finally {
      refreshing.value = false
    }
  }

  return { list, loading, refreshing, load, refreshAll }
}
