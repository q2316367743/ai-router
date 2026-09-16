/**
 * 托盘统计面板：无边框置顶小窗口，点托盘图标弹出，渲染层为独立入口 windows/tray。
 *
 * - 单一实例，隐藏而非销毁（点击响应快、图表状态保留）；失焦自动隐藏。
 * - 定位：按托盘图标 bounds 居中于图标下方（屏幕边缘自动回夹）。
 * - 样式口径与 mainWindow.ts 一致：darwin vibrancy + 透明底 / win32 acrylic / linux 实色。
 */
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import type { BrowserWindowConstructorOptions } from 'electron'

const PANEL_WIDTH = 400
const PANEL_HEIGHT = 640
/** 面板与托盘图标的间距 */
const PANEL_GAP = 6
const PANEL_BACKGROUND = '#F4F4F4'
/** 面板显示事件：通知渲染层刷新（隐藏期间数据已过期） */
const PANEL_SHOWN_CHANNEL = 'tray:shown'

let panel: BrowserWindow | null = null
/** 最近一次隐藏的时间戳：用于抑制「点击托盘图标关闭面板」被 blur 抢先隐藏后立刻重开 */
let lastHideAt = 0
/** 视为同一次点击的抑制窗口（ms） */
const HIDE_SUPPRESS_MS = 250

function panelOptions(): BrowserWindowConstructorOptions {
  const platformOptions: Partial<
    Record<NodeJS.Platform, Partial<BrowserWindowConstructorOptions>>
  > = {
    darwin: { vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000' },
    win32: { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' },
    linux: { backgroundColor: PANEL_BACKGROUND }
  }

  return {
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    ...(platformOptions[process.platform] ?? { backgroundColor: PANEL_BACKGROUND }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow(panelOptions())
  win.on('hide', () => {
    lastHideAt = Date.now()
  })
  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide()
  })
  win.on('closed', () => {
    panel = null
  })

  // dev 下由 renderer dev server 提供多入口页面：/tray.html（去掉末尾斜杠避免双斜杠）
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    void win.loadURL(`${devUrl.replace(/\/$/, '')}/tray.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/tray.html'))
  }

  return win
}

/** 面板窗口（惰性创建） */
function ensurePanel(): BrowserWindow {
  if (!panel || panel.isDestroyed()) panel = createPanel()
  return panel
}

/** 把面板摆到托盘图标下方居中；贴边时回夹到屏幕内 */
function positionPanel(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL_WIDTH / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + PANEL_GAP)

  // 托盘在屏幕下方（如 macOS Dock 位置 / Windows 任务栏在下）时，面板改在图标上方展开
  if (y + PANEL_HEIGHT > workArea.y + workArea.height) {
    y = Math.round(trayBounds.y - PANEL_HEIGHT - PANEL_GAP)
  }
  x = Math.min(Math.max(x, workArea.x + 4), workArea.x + workArea.width - PANEL_WIDTH - 4)
  y = Math.min(Math.max(y, workArea.y + 4), workArea.y + workArea.height - PANEL_HEIGHT - 4)
  win.setPosition(x, y, false)
}

/**
 * 弹出面板（点击托盘图标触发）；已在显示则收起。
 *
 * 注意竞态：点击托盘图标时面板先因失焦隐藏、随后 click 才到达，若直接判断可见性会「关了又开」。
 * 用 lastHideAt 抑制紧跟隐藏后的这次点击。
 */
export function toggleTrayPanel(trayBounds: Electron.Rectangle): void {
  const win = ensurePanel()
  if (win.isVisible()) {
    win.hide()
    return
  }
  if (Date.now() - lastHideAt < HIDE_SUPPRESS_MS) return
  positionPanel(win, trayBounds)
  // 必须真实获得焦点：失焦自动隐藏依赖 blur 事件，showInactive 不会触发
  win.show()
  win.focus()
  // 隐藏期间数据可能已过期，通知面板重新取数（DOM focus 事件在隐藏窗口重新显示时不触发）
  win.webContents.send(PANEL_SHOWN_CHANNEL)
}

/** 隐藏面板（面板内「收起」按钮 / 点击已显示的面板时触发） */
export function hideTrayPanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide()
}
