/**
 * 按操作系统与折叠状态适配标题区左右边距：
 * macOS 交通灯在左上角（trafficLightPosition: x=8，宽约 62px），
 * Windows/Linux 窗口控制按钮在右上角（titleBarOverlay，宽约 138px）。
 * App.vue 声明一次折叠按钮（common-operator），PageLayout 据此计算折叠态标题起点。
 */

/** App.vue common-operator 的折叠按钮尺寸与间距 */
const OPERATOR_SIZE = 32
const OPERATOR_GAP = 8

export interface UseTitlePaddingResult {
  /** 左侧折叠按钮距窗口左边的距离 */
  l1: number
  /** 折叠态标题起点：折叠按钮右侧 */
  l2: number
  /** 右侧按钮为避让系统窗口控制按钮所需的额外右边距 */
  r1: number
}

export const useTitlePadding = (): UseTitlePaddingResult => {
  const isMac = /mac/i.test(navigator.platform)
  // macOS 需让出左侧交通灯；其余平台左侧无系统按钮
  const l1 = isMac ? 76 : OPERATOR_GAP
  const step = OPERATOR_SIZE + OPERATOR_GAP
  // 折叠态标题起点：仅预留折叠按钮一个
  const l2 = l1 + step
  // 右侧叠加在各 header 基础 padding 之上的避让值
  const r1 = isMac ? 0 : 138 + OPERATOR_GAP
  return { l1, l2, r1 }
}
