/** 开机自启状态（以操作系统登录项为唯一权威，不做本地持久化） */
export interface AutoLaunchState {
  /** 当前运行形态与平台是否支持自启（未打包 / 非 macOS、Windows 时为 false） */
  supported: boolean
  /** 系统登录项中当前是否已启用 */
  enabled: boolean
}
