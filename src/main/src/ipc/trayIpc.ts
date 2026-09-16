import { ipcMain } from 'electron'
import { hideTrayPanel } from '../app/trayPanel'
import { showMainWindow } from '../app/mainWindow'

/** 托盘面板域 IPC：面板内的收起与跳转主窗口动作 */
export function registerTrayIpc(): void {
  ipcMain.handle('tray:hide', () => hideTrayPanel())
  ipcMain.handle('tray:openMain', () => showMainWindow())
}
