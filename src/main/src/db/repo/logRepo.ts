import { and, between, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type {
  LogFilterOptions,
  LogListQuery,
  LogListResult,
  RequestLogDetail,
  TodayStats
} from '@common/types'
import { LOG_BODY_RETENTION_HOURS } from '@common/constants'
import { db } from '../client'
import { requestLogs } from '../schema'
import { dateKey, todayKey } from '$/utils/date'
import type { HistoryRef } from './renameRepo'

/** 行保留窗口：最近 7 天（含当天） */
const RETENTION_DAYS = 7
/** 正文清扫单批行数：每批一条语句，批间让出事件循环 */
const BODY_SWEEP_BATCH = 200
/** 正文清扫的批间停顿（ms）：清扫没有时限，要慢慢跑完，不跟代理请求抢主进程 */
const BODY_SWEEP_PAUSE_MS = 50

export type RequestLogEntry = Omit<RequestLogDetail, 'id' | 'logDate'> & HistoryRef
/** pending 行入参：结束阶段才可知的字段全部缺省（由 recordLog 回填） */
export type RequestLogStart = Pick<
  RequestLogEntry,
  | 'requestId'
  | 'startedAt'
  | 'publicModel'
  | 'providerName'
  | 'upstreamModel'
  | 'providerId'
  | 'modelId'
  | 'client'
  | 'path'
  | 'stream'
> &
  Partial<Pick<RequestLogEntry, 'requestHeaders' | 'requestBody'>>

/** 写入观察者：日志落库 / 回填后触发（供 IPC 广播实时推送，db 层不依赖 electron） */
type LogWrittenListener = () => void
const writtenListeners = new Set<LogWrittenListener>()

/** 订阅日志写入事件，返回退订函数 */
export function onLogWritten(listener: LogWrittenListener): () => void {
  writtenListeners.add(listener)
  return () => writtenListeners.delete(listener)
}

function notifyWritten(): void {
  for (const listener of writtenListeners) {
    try {
      listener()
    } catch {
      // 推送失败不影响落库
    }
  }
}

/** 列表查询的轻量投影（不含正文与标头） */
const listColumns = {
  id: requestLogs.id,
  requestId: requestLogs.requestId,
  startedAt: requestLogs.startedAt,
  finishedAt: requestLogs.finishedAt,
  publicModel: requestLogs.publicModel,
  providerName: requestLogs.providerName,
  upstreamModel: requestLogs.upstreamModel,
  client: requestLogs.client,
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

/** 最近一次执行过期清理的日期键：把「每请求一次 DELETE」降为「每天一次」 */
let lastCleanupDate: string | null = null
/** 正文清扫游标（按 id 递增推进）：本进程内有效，重启后从最小 id 重新走一遍 */
let bodySweepCursor = 0
/** 清扫进行中标记：避免同一次清扫并发跑两遍 */
let bodySweeping = false

/**
 * 落一条 pending 日志（请求进入转发前调用）：只写请求侧已知字段，
 * finished_at / status / duration_ms 留 null 表示进行中，正文与标头等结束阶段回填。
 */
export function startLog(entry: RequestLogStart): void {
  try {
    cleanupExpiredLogs()
    db()
      .insert(requestLogs)
      .values({
        requestId: entry.requestId,
        logDate: dateKey(entry.startedAt),
        startedAt: entry.startedAt,
        publicModel: entry.publicModel,
        providerName: entry.providerName,
        upstreamModel: entry.upstreamModel,
        providerId: entry.providerId,
        modelId: entry.modelId,
        client: entry.client,
        path: entry.path,
        stream: entry.stream,
        requestHeaders: entry.requestHeaders ?? null,
        requestBody: entry.requestBody ?? null
      })
      .run()
  } catch {
    // pending 落库失败不影响代理；结束阶段 upsert 会补一条完整记录
  }
  notifyWritten()
}

/**
 * 写入日志（logDate 由请求时间推导）。
 *
 * 以 request_id 为键 upsert：已由 startLog 落过 pending 行的请求回填状态与正文；
 * 同步拦截分支（401/400/404 等，未走 startLog）无匹配行时直接插入，与单阶段写入等价。
 */
export function recordLog(entry: RequestLogEntry): void {
  cleanupExpiredLogs()
  const { requestId, startedAt, ...rest } = entry
  db()
    .insert(requestLogs)
    .values({ requestId, startedAt, ...rest, logDate: dateKey(startedAt) })
    .onConflictDoUpdate({ target: requestLogs.requestId, set: rest })
    .run()
  notifyWritten()
}

/** 清理超出保留窗口（RETENTION_DAYS 天前）的日志；按天节流，同一天内重复调用直接返回 */
export function cleanupExpiredLogs(): void {
  const today = todayKey()
  if (lastCleanupDate === today) return
  lastCleanupDate = today
  const boundary = dateKey(Date.now() - (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000)
  db().delete(requestLogs).where(lt(requestLogs.logDate, boundary)).run()
  void sweepExpiredBodies()
}

/**
 * 清空超出正文保留窗口（LOG_BODY_RETENTION_HOURS 小时）的请求 / 响应正文，行本身照旧保留 7 天。
 *
 * 正文是日志体积的绝对大头（流式响应会把整段 SSE 文本落库），只留最近这段时间、其余置空，
 * 日志表才撑得住 7 天保留期；列表、筛选项、模型速度折线与来源统计只读元数据列，不受影响。
 * 标头不清：KB 级体积，排查时仍有用。
 *
 * 按 id 递增分批推进（id 自增即时间序，到达边界后最后一批自然清空退出）：首次启用要清掉
 * 此前积累的多天正文，分批 + 批间停顿只会表现为后台慢慢跑，不会一次 UPDATE 卡住主进程。
 */
async function sweepExpiredBodies(): Promise<void> {
  if (bodySweeping) return
  bodySweeping = true
  const startedAtLimit = Date.now() - LOG_BODY_RETENTION_HOURS * 60 * 60 * 1000
  try {
    for (;;) {
      const rows = db()
        .select({ id: requestLogs.id })
        .from(requestLogs)
        .where(
          and(
            gt(requestLogs.id, bodySweepCursor),
            lt(requestLogs.startedAt, startedAtLimit),
            or(isNotNull(requestLogs.requestBody), isNotNull(requestLogs.responseBody))
          )
        )
        .orderBy(requestLogs.id)
        .limit(BODY_SWEEP_BATCH)
        .all()
      const last = rows[rows.length - 1]
      if (!last) return
      db()
        .update(requestLogs)
        .set({ requestBody: null, responseBody: null })
        .where(
          inArray(
            requestLogs.id,
            rows.map((row) => row.id)
          )
        )
        .run()
      bodySweepCursor = last.id
      await pause(BODY_SWEEP_PAUSE_MS)
    }
  } finally {
    bodySweeping = false
  }
}

/** 批次间的停顿：让 IPC 与代理请求先跑（用 setTimeout 而非 setImmediate，避免长时间占满主进程） */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 标记残留的进行中日志为「服务中断」。
 *
 * 应用退出 / 崩溃时已落 pending 但未回填的行会永远停在进行中，启动时统一收口为 499。
 * 这些请求从未写入用量聚合表（聚合只在结束时累加），因此日志条数会略多于统计请求数。
 */
export function markPendingInterrupted(): void {
  const now = Date.now()
  db()
    .update(requestLogs)
    .set({
      status: 499,
      finishedAt: now,
      durationMs: sql`${now} - ${requestLogs.startedAt}`,
      error: '服务中断'
    })
    .where(isNull(requestLogs.finishedAt))
    .run()
}

/** 组合列表筛选条件（成功 = 2xx，失败 = 非 2xx 且已结束；provider/model/client 精确匹配） */
function listWhere(query: LogListQuery) {
  return and(
    query.status === 'success' ? between(requestLogs.status, 200, 299) : undefined,
    query.status === 'fail'
      ? and(isNotNull(requestLogs.status), or(lt(requestLogs.status, 200), gt(requestLogs.status, 299)))
      : undefined,
    query.provider ? eq(requestLogs.providerName, query.provider) : undefined,
    query.model ? eq(requestLogs.publicModel, query.model) : undefined,
    query.client ? eq(requestLogs.client, query.client) : undefined
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

/** 列表筛选项：现有日志中去重后的供应商 / 请求模型 / 来源客户端（字典序） */
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
  // 来源列可空（未携带 UA / 上线前历史行），筛选项只收有值的
  const clients = db()
    .selectDistinct({ value: requestLogs.client })
    .from(requestLogs)
    .all()
    .map((r) => r.value)
    .filter((value): value is string => value !== null)
    .sort()
  return { providers, models, clients }
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
