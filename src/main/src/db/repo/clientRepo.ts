import { and, gte, lte, sql } from 'drizzle-orm'
import type { UsageAgentFlow, UsageAgentFlowLink, UsageClientItem, UsageClientStats } from '@common/types'
import { db } from '../client'
import { requestLogs } from '../schema'
import { resolveRange } from './usageRepo'

/**
 * 来源客户端仓储：与 `speedRepo.ts` 同属「直接实时聚合 request_logs」的统计项（不读用量聚合表）。
 *
 * 聚合表按 `(时间桶, 供应商, 模型)` 分区，没有来源维度，而日志表只保留 7 天，撑不起近 30 天维度，
 * 因此本项窗口固定近七天且不参与看板的维度切换与供应商/模型筛选 —— 与模型速度折线同一取舍。
 */

/** 未携带 UA 的请求（含本列上线前的历史行）在图表上的归组名 */
const UNKNOWN_CLIENT = '未知'

/** 来源客户端请求数：窗口内按 client 分组计数，请求数降序 */
export function queryClientStats(): UsageClientStats {
  const range = resolveRange('last7d')
  const rows = db()
    .select({
      client: requestLogs.client,
      requestCount: sql<number>`count(*)`
    })
    .from(requestLogs)
    .where(and(gte(requestLogs.logDate, range.startKey), lte(requestLogs.logDate, range.endKey)))
    .groupBy(requestLogs.client)
    .all()

  const items: UsageClientItem[] = rows
    .map((row) => ({
      name: row.client ?? UNKNOWN_CLIENT,
      requestCount: Number(row.requestCount)
    }))
    .sort((a, b) => b.requestCount - a.requestCount || a.name.localeCompare(b.name))

  return { startDate: range.startKey, endDate: range.endKey, items }
}

/**
 * Agent × 提供商交叉流量（桑基图用）：窗口内按 `(client, provider_name)` 分组计数，请求数降序。
 *
 * 与来源请求数同源：聚合表按「时间桶 × 供应商 × 模型」分区、没有来源维度，只有日志表同时有
 * client 与 provider_name，故窗口固定近七天、含失败请求。Top 截断与「其他」合并留给前端。
 */
export function queryAgentProviderFlow(): UsageAgentFlow {
  const range = resolveRange('last7d')
  const rows = db()
    .select({
      client: requestLogs.client,
      providerName: requestLogs.providerName,
      requestCount: sql<number>`count(*)`
    })
    .from(requestLogs)
    .where(and(gte(requestLogs.logDate, range.startKey), lte(requestLogs.logDate, range.endKey)))
    .groupBy(requestLogs.client, requestLogs.providerName)
    .all()

  const links: UsageAgentFlowLink[] = rows
    .map((row) => ({
      client: row.client ?? UNKNOWN_CLIENT,
      providerName: row.providerName,
      requestCount: Number(row.requestCount)
    }))
    .sort(
      (a, b) =>
        b.requestCount - a.requestCount ||
        a.client.localeCompare(b.client) ||
        a.providerName.localeCompare(b.providerName)
    )

  return { startDate: range.startKey, endDate: range.endKey, links }
}
