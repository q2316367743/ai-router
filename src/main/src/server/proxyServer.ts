import type { Server } from 'node:http'
import { BrowserWindow } from 'electron'
import type { ServiceStatus } from '@common/types'
import { getServiceConfig } from '$/db/repo/settingRepo'
import { createProxyApp } from './proxyRouter'

let httpServer: Server | null = null
let status: ServiceStatus = { state: 'stopped', port: 0 }

export function getServerStatus(): ServiceStatus {
  return status
}

/** 按当前配置启动服务（幂等：先停旧实例）；未启用或端口占用不抛错，仅更新状态 */
export async function startProxyServer(): Promise<void> {
  stopProxyServer()
  const config = getServiceConfig()
  if (!config.enabled) {
    updateStatus({ state: 'stopped', port: config.port })
    return
  }

  await new Promise<void>((resolve) => {
    const onListenError = (err: Error): void => {
      updateStatus({ state: 'error', port: config.port, error: err.message })
      resolve()
    }
    const server = createProxyApp().listen(config.port, '127.0.0.1', () => {
      // 监听成功后，后续运行期错误只记日志
      server.off('error', onListenError)
      server.on('error', (err) => console.error('[proxy-server]', err))
      updateStatus({ state: 'running', port: config.port })
      resolve()
    })
    server.once('error', onListenError)
    httpServer = server
  })
}

export function stopProxyServer(): void {
  if (!httpServer) return
  const server = httpServer
  httpServer = null
  server.close()
  server.closeAllConnections()
}

export async function restartProxyServer(): Promise<void> {
  await startProxyServer()
}

function updateStatus(next: ServiceStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('server:status', next)
  }
}
