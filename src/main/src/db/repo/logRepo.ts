import { and, eq, lt, sql } from 'drizzle-orm'
import type { RequestLogItem, TodayStats } from '@common/types'
import { db } from '../client'
import { requestLogs } from '../schema'
import { todayKey } from '../../utils/date'

export type RequestLogEntry = Omit<RequestLogItem, 'id' | 'createdAt'>

/** 写入当日日志；写入前惰性清理历史日志（仅保留当天） */
export function recordLog(entry: RequestLogEntry): void {
  cleanupExpiredLogs()
  db()
    .insert(requestLogs)
    .values({ ...entry, logDate: todayKey(), createdAt: Date.now() })
    .run()
}

/** 启动时清理一次：上次运行残留的历史日志 */
export function cleanupExpiredLogs(): void {
  db().delete(requestLogs).where(lt(requestLogs.logDate, todayKey())).run()
}

export function listTodayLogs(): RequestLogItem[] {
  return db()
    .select({
      id: requestLogs.id,
      createdAt: requestLogs.createdAt,
      publicModel: requestLogs.publicModel,
      providerName: requestLogs.providerName,
      upstreamModel: requestLogs.upstreamModel,
      path: requestLogs.path,
      status: requestLogs.status,
      durationMs: requestLogs.durationMs,
      stream: requestLogs.stream,
      promptTokens: requestLogs.promptTokens,
      completionTokens: requestLogs.completionTokens,
      totalTokens: requestLogs.totalTokens,
      error: requestLogs.error
    })
    .from(requestLogs)
    .where(eq(requestLogs.logDate, todayKey()))
    .orderBy(sql`${requestLogs.createdAt} desc`)
    .all()
}

export function clearTodayLogs(): void {
  db().delete(requestLogs).where(eq(requestLogs.logDate, todayKey())).run()
}

export function getTodayStats(): TodayStats {
  const row = db()
    .select({
      requestCount: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${requestLogs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${requestLogs.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`
    })
    .from(requestLogs)
    .where(and(eq(requestLogs.logDate, todayKey())))
    .get()
  return {
    requestCount: Number(row?.requestCount ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0)
  }
}
