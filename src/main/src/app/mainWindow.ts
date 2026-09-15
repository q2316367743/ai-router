/**
 * 主窗口模块：whenReady 时创建（show: false + ready-to-show 防白屏）。
 * 标题栏按平台差异配置 Fluent 风格：
 * - darwin：hiddenInset 隐藏标题栏（保留交通灯）+ vibrancy 系统毛玻璃 + 透明背景
 * - win32 ：hidden + titleBarOverlay（原生控制按钮）+ acrylic 毛玻璃 + 透明背景让其生效
 * - linux ：hidden + titleBarOverlay + 实色背景（无毛玻璃能力）
 * 渲染层对应在 App.vue 顶部放置 .window-drag-region 拖拽区。
 */
import { BrowserWindow, shell } from 'electron'
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

/** 创建并加载主窗口（已存在则直接返回） */
export function createMainWindow(): BrowserWindow {
  if (mainWindow) return mainWindow

  mainWindow = new BrowserWindow(windowOptions())

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
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
