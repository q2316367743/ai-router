/**
 * 主窗口模块：whenReady 时创建（show: false + ready-to-show 防白屏）。
 * 标题栏按平台差异配置 Fluent 风格：
 * - darwin：hiddenInset 隐藏标题栏（保留交通灯）+ vibrancy 系统毛玻璃 + 透明背景
 * - win32 ：hidden + titleBarOverlay（原生控制按钮）+ acrylic 毛玻璃 + 透明背景让其生效
 * - linux ：hidden + titleBarOverlay + 实色背景（无毛玻璃能力）
 * 渲染层对应在 App.vue 顶部放置 .window-drag-region 拖拽区。
 * macOS Dock 跟随主窗口可见性（显示才显示 Dock，隐藏/关闭即隐藏），托盘面板不参与。
 */
import { app, BrowserWindow, shell } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

const WINDOW_BACKGROUND = '#F4F4F4'

function windowOptions(): BrowserWindowConstructorOptions {
  const platformOptions: Partial<
    Record<NodeJS.Platform, Partial<BrowserWindowConstructorOptions>>
  > = {
    darwin: {
      titleBarStyle: 'hiddenInset',
      // 显式指定交通灯位置，将按钮整体下移（默认 y 11 -> 17）
      trafficLightPosition: { x: 8, y: 17 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    },
    win32: {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: WINDOW_BACKGROUND, symbolColor: '#000000', height: 40 },
      backgroundMaterial: 'acrylic',
      backgroundColor: '#00000000'
    },
    linux: {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: WINDOW_BACKGROUND, symbolColor: '#000000', height: 40 },
      backgroundColor: WINDOW_BACKGROUND
    }
  }

  return {
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(platformOptions[process.platform] ?? { backgroundColor: WINDOW_BACKGROUND }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
}

let mainWindow: BrowserWindow | null = null

/**
 * macOS Dock 跟随主窗口可见性：主窗口显示才显示 Dock，隐藏/关闭即隐藏。
 * 托盘面板窗口不参与判断。必须在 ready 之后调用（createMainWindow 由 whenReady 触发）。
 */
function syncDock(visible: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (visible === app.dock.isVisible()) return
  if (visible) app.dock.show()
  else app.dock.hide()
}

/** 创建并加载主窗口（已存在则直接返回） */
export function createMainWindow(): BrowserWindow {
  if (mainWindow) return mainWindow

  // 启动时窗口尚未显示，先隐藏 Dock，避免启动瞬间图标闪烁
  syncDock(false)

  mainWindow = new BrowserWindow(windowOptions())

  mainWindow.on('ready-to-show', () => {
    // 必须先恢复 Dock 再 show，否则窗口无法正常激活前置
    syncDock(true)
    mainWindow?.show()
  })

  mainWindow.on('hide', () => syncDock(false))

  // 关窗后置空，避免残留已销毁实例（托盘/Dock 重开依赖）
  mainWindow.on('closed', () => {
    mainWindow = null
    syncDock(false)
  })

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/** 显示主窗口：存活则前置聚焦，已关闭则重建 */
export function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    syncDock(true)
    mainWindow.show()
    mainWindow.focus()
    return
  }
  createMainWindow()
}
