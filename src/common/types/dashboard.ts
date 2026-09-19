/**
 * 看板卡片布局契约：首页 / 托盘面板各自独立的「显示 + 顺序」配置。
 *
 * 存于 settings 表单键（值为此配置的 JSON 文本），读写走 setting 域通用通道；
 * 卡片 id 的唯一事实源在渲染层 cardRegistry（卡片清单不跨进程，配置只存 id + 可见性）。
 */

/** 看板所在界面：主窗口首页 / 托盘面板（未来新窗口在此扩展） */
export type DashboardSurface = 'home' | 'tray'

export interface DashboardLayoutItem {
  /** 卡片 id，与渲染层 cardRegistry 的注册 id 对应 */
  id: string
  visible: boolean
}

/** 每个界面一份有序列表；顺序即渲染顺序，隐藏卡也保留位置（重新打开不漂移） */
export type DashboardLayoutConfig = Partial<Record<DashboardSurface, DashboardLayoutItem[]>>

/** settings 表存储键 */
export const DASHBOARD_LAYOUT_SETTING_KEY = 'dashboard.layout'
