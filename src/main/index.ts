import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { isOpenedAtLogin } from '$/app/autoLaunch'
import { createMainWindow, showMainWindow } from '$/app/mainWindow'
import { registerAppTray } from '$/app/tray'
import { initDb } from '$/db/client'
import { cleanupLogsOnStartup } from '$/ipc/logIpc'
import { registerIpc } from '$/registerIpc'
import { ensureServiceDefaults } from '$/db/repo/settingRepo'
import { startProxyServer, stopProxyServer } from '$/server'

// 单实例锁：二次拉起直接退出
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('xyz.esion.airouter')

    // F12 开关 DevTools、生产环境屏蔽刷新快捷键
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 注册全部业务 IPC
    registerIpc()

    // 打开并迁移数据库（~/.ai-router/db/ai-router.db）
    initDb()

    // 服务默认配置 + 清理残留历史日志
    ensureServiceDefaults()
    cleanupLogsOnStartup()

    // 启动本地代理服务（未启用时仅更新状态）
    await startProxyServer()

    // 注册系统托盘（macOS 标题实时显示今日用量）
    registerAppTray()

    if (isOpenedAtLogin()) {
      // 开机自启：静默驻留托盘，仅代理服务后台运行；macOS 同步隐藏 Dock
      if (process.platform === 'darwin') app.dock?.hide()
    } else {
      // 创建主窗口
      createMainWindow()
    }

    // macOS 点击 Dock：无窗口时重建
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })

    // 二次启动（如静默驻留托盘时再次打开应用）：唤出主窗口，避免无任何反馈
    app.on('second-instance', () => showMainWindow())
  })

  app.on('will-quit', () => {
    stopProxyServer()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
