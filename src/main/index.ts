import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from '$/app/mainWindow'
import { registerAppTray } from '$/app/tray'
import { initDb } from '$/db/client'
import { cleanupLogsOnStartup } from '$/ipc/logIpc'
import { registerIpc } from '$/registerIpc'
import { ensureServiceDefaults } from '$/db/repo/settingRepo'
import { startProxyServer, stopProxyServer } from '$/server/proxyServer'

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

    // 创建主窗口
    createMainWindow()

    // 注册系统托盘（macOS 标题实时显示今日用量）
    registerAppTray()

    // macOS 点击 Dock：无窗口时重建
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('will-quit', () => {
    stopProxyServer()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
