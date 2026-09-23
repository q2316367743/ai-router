/**
 * 托盘额度面板契约：展示哪些提供商、顺序、以及余额告警阈值。
 *
 * 存于 settings 表单键（值为此配置的 JSON 文本），读写走 setting 域通用通道；
 * 展示项以 providerId 为键（提供商名可改、可重名，不能当键）。
 */

export interface TrayQuotaItem {
  /** providers.id */
  providerId: string
  visible: boolean
}

export interface TrayQuotaConfig {
  /** 有序列表：顺序即渲染顺序，隐藏项也保留位置（重新打开不漂移） */
  items?: TrayQuotaItem[]
  /** 余额告警阈值：余额低于该值时卡片转告警色（按快照原币种数值比较，不分币种） */
  balanceAlertThreshold?: number
}

/** settings 表存储键 */
export const TRAY_QUOTA_SETTING_KEY = 'tray.quota'

/** 余额告警阈值缺省值 */
export const DEFAULT_BALANCE_ALERT_THRESHOLD = 10
