/**
 * 看板卡片注册表的类型契约（独立成文件避免「注册表 ↔ 卡片组件」循环引用）。
 *
 * 所有看板卡片统一 props 契约：只收一个 ctx（外加注册表经 extraProps 下发的静态附加 props），
 * 数据自给自足从 ctx 取——新增卡片无需改动看板主体的任何绑定逻辑。
 */
import type { Component } from 'vue'
import type { DashboardSurface, UsageClientStats, UsageModelSpeed } from '@common/types'
import type { UseUsageStatsResult } from './useUsageStats'

/** 看板传给每张卡片的渲染上下文：统计实例 + 界面形态 + 页面级取数的两张近七天图 */
export interface DashboardCardContext {
  stats: UseUsageStatsResult
  /** 紧凑模式（托盘窄面板）：卡片自行压矮图表、缩小数值 */
  compact: boolean
  /** 模型速度趋势数据（固定近七天，仅首页取数） */
  speed: UsageModelSpeed | null
  /** 来源 Agent 请求数数据（固定近七天，仅首页取数） */
  clients: UsageClientStats | null
}

/** 栅格跨度：cell = 单格指标卡；half = 半行（首页跨 2 列 / 托盘占 1 列）；full = 整行 */
export type DashboardCardSpan = 'cell' | 'half' | 'full'

export interface DashboardCardDef {
  /** 注册 id：布局配置以此持久化，注册后不可改名（改名等于换卡） */
  id: string
  /** 中文名：配置抽屉里展示 */
  title: string
  /** tdesign 图标名（t-icon name，抽屉行内展示） */
  icon: string
  component: Component
  /** 出现在哪些界面（如速度/来源 Agent 仅首页） */
  surfaces: DashboardSurface[]
  /** 无用户配置时的默认可见性；版本升级追加的新卡即以此值出现 */
  defaultVisible: boolean
  span: DashboardCardSpan
  /** 静态附加 props（统计卡的 cardKey 等），v-bind 下发 */
  extraProps?: Record<string, unknown>
}
