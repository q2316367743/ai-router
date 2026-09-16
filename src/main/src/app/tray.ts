/**
 * 应用托盘：常驻菜单栏入口。
 *
 * - darwin / win32：左键点击弹出统计面板窗口（trayPanel），右键弹原生菜单（打开主窗口 / 打开统计面板 / 退出）。
 *   注意不能在 mac 上同时 `setContextMenu`，否则左键会被菜单吞掉。
 * - linux：多数桌面环境的托盘只支持菜单（无 click 事件），保留 setContextMenu 并在菜单内提供「打开统计面板」。
 * - darwin 在图标旁以标题实时显示今日 token 用量（K/M/E 缩写）；其他平台用量只进 tooltip。
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import appIcon from '@resources/icon.png?asset'
import { formatTokens } from '@common/utils/format'
import { listUsageByRange } from '$/db/repo/usageRepo'
import { todayKey } from '$/utils/date'
import { showMainWindow } from './mainWindow'
import { toggleTrayPanel } from './trayPanel'

/** 兜底刷新周期：覆盖跨天归零与写库钩子遗漏的场景 */
const REFRESH_INTERVAL = 30_000

let tray: Tray | null = null

/** 今日 token 总量（usage_daily 按 todayKey 聚合，写入时已按 日期 × 供应商 × 模型 累加） */
function queryTodayTokens(): number {
  const key = todayKey()
  return listUsageByRange(key, key).reduce((sum, item) => sum + item.totalTokens, 0)
}

/** 刷新今日用量显示（macOS 标题 + 全平台 tooltip），失败静默不影响托盘 */
export function refreshTrayUsage(): void {
  try {
    if (!tray) return
    const text = formatTokens(queryTodayTokens())
    tray.setToolTip(`AI Router · 今日 ${text} tokens`)
    if (process.platform === 'darwin') {
      tray.setTitle(` ${text}`)
    }
  } catch {
    // 用量查询失败不影响托盘基础功能
  }
}

/** 托盘右键菜单模板（linux 作为主菜单） */
function menuTemplate(): MenuItemConstructorOptions[] {
  return [
    { label: '打开主窗口', click: showMainWindow },
    { label: '打开统计面板', click: () => tray && toggleTrayPanel(tray.getBounds()) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
}

export function registerAppTray(): void {
  // 16px 主表示 + 32px @2x 表示，retina 菜单栏不糊
  const source = nativeImage.createFromPath(appIcon)
  const icon = source.resize({ width: 16, height: 16 })
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: 32, height: 32 }).toPNG()
  })

  tray = new Tray(icon)
  tray.setToolTip('AI Router')

  if (process.platform === 'linux') {
    // Linux 托盘普遍不派发 click 事件，只能用菜单入口
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()))
  } else {
    // 不挂 contextMenu：左键留给统计面板，右键手动弹出菜单
    tray.on('click', () => tray && toggleTrayPanel(tray.getBounds()))
    tray.on('right-click', () => tray?.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())))
  }

  refreshTrayUsage()
  setInterval(refreshTrayUsage, REFRESH_INTERVAL)
}
