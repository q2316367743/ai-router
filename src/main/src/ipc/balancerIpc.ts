import { ipcMain } from 'electron'
import type { ChannelHealthInfo } from '@common/types'
import { channelStateOf } from '@common/utils/balancerDisplay'
import { listProviders } from '$/db/repo/providerRepo'
import { healthSnapshot, resetChannel } from '$/server/balancer'

/**
 * 负载均衡域 IPC：渠道健康快照与手动重置。
 *
 * 只做读取与转发（数据源是主进程内存态）；健康度以 providerId 为键，提供商名在组装时联表补上，
 * 因此提供商重命名后健康列不会错位。
 */
export function registerBalancerIpc(): void {
  ipcMain.handle('balancer:states', () => listChannelStates())

  // 手动重置：充值 / 修好 Key 之后不想等下一轮余量刷新的逃生口
  ipcMain.handle('balancer:reset', (_e, providerId: string) => {
    if (!providerId) throw new Error('缺少 providerId')
    resetChannel(providerId)
  })
}

/** 全部未归档提供商的健康快照：没有任何失败记录的提供商显示为满值正常 */
function listChannelStates(): ChannelHealthInfo[] {
  return listProviders()
    .filter((provider) => provider.archivedAt === null)
    .map((provider) => {
      const health = healthSnapshot(provider.id)
      return {
        providerId: provider.id,
        providerName: provider.name,
        availability: health.availability,
        state: channelStateOf(health.availability),
        blockReason: health.quotaBlocked ? health.blockReason : null,
        blockUntil: health.quotaBlocked ? health.blockUntil : null,
        consecutiveFailures: health.consecutiveFailures,
        lastError: health.lastError,
        lastFailureAt: health.lastFailureAt,
        lastSuccessAt: health.lastSuccessAt
      }
    })
}
