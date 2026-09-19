import { ipcRenderer } from 'electron'

const CHANGED_CHANNEL = 'setting:changed'

function isKeyPayload(payload: unknown): payload is { key: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'key' in payload &&
    typeof payload.key === 'string'
  )
}

/** 通用键值设置桥：渲染层 UI 偏好的持久化（main 侧 JSON 序列化存 settings 表） */
export const settingApi = {
  /** 读取键值（值经 JSON 解析；键不存在或脏数据返回 null） */
  get(key: string): Promise<unknown> {
    return ipcRenderer.invoke('setting:get', key)
  },
  /** 写入键值并广播 setting:changed（所有窗口收到） */
  set(key: string, value: unknown): Promise<void> {
    return ipcRenderer.invoke('setting:set', key, value)
  },
  /** 订阅设置变更广播（任意窗口保存触发，携带变更的键名），返回退订函数 */
  onSettingChanged(cb: (key: string) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
      if (isKeyPayload(payload)) cb(payload.key)
    }
    ipcRenderer.on(CHANGED_CHANNEL, listener)
    return () => ipcRenderer.off(CHANGED_CHANNEL, listener)
  }
}
