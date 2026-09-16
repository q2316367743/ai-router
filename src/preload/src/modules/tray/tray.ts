import { ipcRenderer } from 'electron'

/** 面板显示事件：主进程每次弹出面板时推送，渲染层据此重新取数 */
const SHOWN_CHANNEL = 'tray:shown'

/** 托盘面板窗口专用：收起面板 / 打开主窗口 / 订阅显示事件 */
export const trayApi = {
  hide(): Promise<void> {
    return ipcRenderer.invoke('tray:hide')
  },
  openMain(): Promise<void> {
    return ipcRenderer.invoke('tray:openMain')
  },
  /** 订阅面板显示（每次弹出触发，用于刷新过期数据），返回退订函数 */
  onShown(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on(SHOWN_CHANNEL, listener)
    return () => ipcRenderer.off(SHOWN_CHANNEL, listener)
  }
}
