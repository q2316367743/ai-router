import { BrowserWindow, ipcMain } from 'electron'
import { getSetting, setSetting } from '$/db/repo/settingRepo'

const CHANGED_CHANNEL = 'setting:changed'

/**
 * 通用键值设置域 IPC：渲染层 UI 偏好的持久化通道（值 JSON 序列化存 settings 表）。
 * 保存后向所有窗口广播 setting:changed，使另一窗口（如托盘面板）实时同步。
 */
export function registerSettingIpc(): void {
  ipcMain.handle('setting:get', (_e, key: string) => {
    if (typeof key !== 'string' || !key) return null
    const raw = getSetting(key)
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed
    } catch {
      // 脏数据按「无配置」处理，调用方回退默认值
      return null
    }
  })

  ipcMain.handle('setting:set', (_e, key: string, value: unknown) => {
    if (typeof key !== 'string' || !key) throw new Error('参数错误')
    setSetting(key, JSON.stringify(value ?? null))
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CHANGED_CHANNEL, { key })
    }
  })
}
