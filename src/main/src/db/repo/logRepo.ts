import { and, between, eq, gt, lt, or, sql } from 'drizzle-orm'
import type {
  LogFilterOptions,
  LogListQuery,
  LogListResult,
  RequestLogDetail,
  TodayStats
} from '@common/types'
import { db } from '../client'
import { requestLogs } from '../schema'
import { dateKey, todayKey } from '../../utils/date'

/** 保留窗口：最近 7 天（含当天） */
const RETENTION_DAYS = 7

export type RequestLogEntry = Omit<RequestLogDetail, 'id' | 'logDate'>

/** 列表查询的轻量投影（不含正文与标头） */
const listColumns = {
  id: requestLogs.id,
  requestId: requestLogs.requestId,
  startedAt: requestLogs.startedAt,
  finishedAt: requestLogs.finishedAt,
  publicModel: requestLogs.publicModel,
  providerName: requestLogs.providerName,
  upstreamModel: requestLogs.upstreamModel,
  path: requestLogs.path,
  status: requestLogs.status,
  durationMs: requestLogs.durationMs,
  stream: requestLogs.stream,
  promptTokens: requestLogs.promptTokens,
  completionTokens: requestLogs.completionTokens,
  reasoningTokens: requestLogs.reasoningTokens,
  cacheReadTokens: requestLogs.cacheReadTokens,
  cacheWriteTokens: requestLogs.cacheWriteTokens,
  unrecognizedTokens: requestLogs.unrecognizedTokens,
  totalTokens: requestLogs.totalTokens,
  error: requestLogs.error
}

/** 写入日志（logDate 由请求时间推导）；写入前惰性清理超窗日志 */
export function recordLog(entry: RequestLogEntry): void {
  cleanupExpiredLogs()
  db()
    .insert(requestLogs)
    .values({ ...entry, logDate: dateKey(entry.startedAt) })
    .run()
}

/** 清理超出保留窗口（RETENTION_DAYS 天前）的日志 */
export function cleanupExpiredLogs(): void {
  const boundary = dateKey(Date.now() - (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000)
  db().delete(requestLogs).where(lt(requestLogs.logDate, boundary)).run()
}

/** 组合列表筛选条件（成功 = 2xx，失败 = 非 2xx；provider/model 精确匹配） */
function listWhere(query: LogListQuery) {
  return and(
    query.status === 'success' ? between(requestLogs.status, 200, 299) : undefined,
    query.status === 'fail' ? or(lt(requestLogs.status, 200), gt(requestLogs.status, 299)) : undefined,
    query.provider ? eq(requestLogs.providerName, query.provider) : undefined,
    query.model ? eq(requestLogs.publicModel, query.model) : undefined
  )
}

/** 按条件分页查询日志列表（started_at 倒序） */
export function listLogs(query: LogListQuery): LogListResult {
  const where = listWhere(query)
  const items = db()
    .select(listColumns)
    .from(requestLogs)
    .where(where)
    .orderBy(sql`${requestLogs.startedAt} desc`)
    .limit(query.pageSize)
    .offset((Math.max(1, query.page) - 1) * query.pageSize)
    .all()
  const row = db()
    .select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(where)
    .get()
  return { items, total: Number(row?.count ?? 0) }
}

/** 列表筛选项：现有日志中去重后的供应商与请求模型（字典序） */
export function listFilterOptions(): LogFilterOptions {
  const providers = db()
    .selectDistinct({ value: requestLogs.providerName })
    .from(requestLogs)
    .all()
    .map((r) => r.value)
    .sort()
  const models = db()
    .selectDistinct({ value: requestLogs.publicModel })
    .from(requestLogs)
    .all()
    .map((r) => r.value)
    .sort()
  return { providers, models }
}

/** 按 ID 查询单条日志全量详情（含正文与标头） */
export function getLogDetail(id: number): RequestLogDetail | null {
  return db().select().from(requestLogs).where(eq(requestLogs.id, id)).get() ?? null
}

/** 清空全部日志（保留窗口内） */
export function clearAllLogs(): void {
  db().delete(requestLogs).run()
}

export function getTodayStats(): TodayStats {
  const row = db()
    .select({
      requestCount: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${requestLogs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${requestLogs.completionTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${requestLogs.reasoningTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${requestLogs.cacheReadTokens}), 0)`,
      cacheWriteTokens: sql<number>`coalesce(sum(${requestLogs.cacheWriteTokens}), 0)`,
      unrecognizedTokens: sql<number>`coalesce(sum(${requestLogs.unrecognizedTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`
    })
    .from(requestLogs)
    .where(and(eq(requestLogs.logDate, todayKey())))
    .get()
  return {
    requestCount: Number(row?.requestCount ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    reasoningTokens: Number(row?.reasoningTokens ?? 0),
    cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
    unrecognizedTokens: Number(row?.unrecognizedTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0)
  }
}
