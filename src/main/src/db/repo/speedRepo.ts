import { and, between, gt, gte, lte, sql } from 'drizzle-orm'
import type { UsageModelSpeed, UsageSpeedLine } from '@common/types'
import { db } from '../client'
import { requestLogs } from '../schema'
import { dayLabel } from '$/utils/date'
import { resolveRange } from './usageRepo'

/**
 * 模型速度仓储：唯一直接实时聚合 request_logs 的统计项（不读用量聚合表）。
 *
 * 之所以独立成文件而不并入 usageRepo：本域读的是日志表而非聚合表，口径与实现都自成一套；
 * 且拆开后两个文件都在 RL-05 的 500 行约束内。
 */

/** 折线保留的线数上限：按窗口内输出 token 量取前 N，避免图例挤爆 */
const SPEED_LINE_LIMIT = 5

/**
 * 模型速度折线：固定近七天窗口，按「日期 × 供应商 × 模型」聚合每日输出速度（token/s）。
 *
 * 数据源是 request_logs 而非聚合表：聚合表的 duration_ms 累加全部请求（含失败）而 token 只累加成功请求，
 * 两者相除口径错配（本地拦截的 401/404 瞬间返回会把速度抬高，客户端断开的 499 长挂会压低），
 * 因此必须逐请求按 2xx 筛选。窗口天数与日志保留期一致（7 天），无需额外落库。
 *
 * 速度 = 当日该组合 sum(输出 token) / sum(耗时)，即按 token 量加权的平均速度；
 * 无有效请求的日期为 null，由折线断开而非画到 0。
 */
export function queryModelSpeed(): UsageModelSpeed {
  const range = resolveRange('last7d')
  const rows = db()
    .select({
      bucket: requestLogs.logDate,
      providerName: requestLogs.providerName,
      publicModel: requestLogs.publicModel,
      completionTokens: sql<number>`coalesce(sum(${requestLogs.completionTokens}), 0)`,
      durationMs: sql<number>`coalesce(sum(${requestLogs.durationMs}), 0)`
    })
    .from(requestLogs)
    .where(
      and(
        gte(requestLogs.logDate, range.startKey),
        lte(requestLogs.logDate, range.endKey),
        between(requestLogs.status, 200, 299),
        gt(requestLogs.completionTokens, 0),
        gt(requestLogs.durationMs, 0)
      )
    )
    .groupBy(requestLogs.logDate, requestLogs.providerName, requestLogs.publicModel)
    .all()

  const bucketIndex = new Map(range.buckets.map((key, i) => [key, i]))
  const size = range.buckets.length
  /** 逐条线累积窗口内总输出 token（仅用于排序取前 N，不参与速度计算） */
  const series = new Map<string, { tokens: number; data: (number | null)[] }>()

  for (const row of rows) {
    const index = bucketIndex.get(row.bucket)
    if (index === undefined) continue
    const name = `${row.providerName} · ${row.publicModel}`
    let line = series.get(name)
    if (!line) {
      line = { tokens: 0, data: new Array<number | null>(size).fill(null) }
      series.set(name, line)
    }
    const completionTokens = Number(row.completionTokens)
    const durationMs = Number(row.durationMs)
    line.tokens += completionTokens
    line.data[index] = (completionTokens * 1000) / durationMs
  }

  const lines: UsageSpeedLine[] = [...series.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens || a[0].localeCompare(b[0]))
    .slice(0, SPEED_LINE_LIMIT)
    .map(([name, line]) => ({ name, data: line.data }))

  return {
    buckets: range.buckets,
    labels: range.buckets.map(dayLabel),
    lines
  }
}
