import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from '$/app/mainWindow'
import { initDb } from '$/db/client'
import { registerIpc } from '$/registerIpc'

// 单实例锁：二次拉起直接退出
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('xyz.esion.airouter')

    // F12 开关 DevTools、生产环境屏蔽刷新快捷键
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 注册全部业务 IPC
    registerIpc()

    // 打开并迁移数据库（~/.ai-router/db/ai-router.db）
    initDb()

    // 创建主窗口
    createMainWindow()

    // macOS 点击 Dock：无窗口时重建
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
