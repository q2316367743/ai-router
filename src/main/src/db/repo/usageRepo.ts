import { and, asc, gte, lte, sql } from 'drizzle-orm'
import type { UsageDailyItem } from '@common/types'
import { db } from '../client'
import { usageDaily } from '../schema'
import { todayKey } from '$/utils/date'

export interface AddUsageParams {
  publicModel: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 累加当日用量：无行则插入，有行则原值 + 本次（requestCount 固定 +1） */
export function addUsage(params: AddUsageParams): void {
  db()
    .insert(usageDaily)
    .values({
      date: todayKey(),
      publicModel: params.publicModel,
      requestCount: 1,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.totalTokens
    })
    .onConflictDoUpdate({
      target: [usageDaily.date, usageDaily.publicModel],
      set: {
        requestCount: sql`${usageDaily.requestCount} + 1`,
        promptTokens: sql`${usageDaily.promptTokens} + excluded.prompt_tokens`,
        completionTokens: sql`${usageDaily.completionTokens} + excluded.completion_tokens`,
        totalTokens: sql`${usageDaily.totalTokens} + excluded.total_tokens`
      }
    })
    .run()
}

/** 查询日期区间（含边界）内按日 × 模型的用量明细 */
export function listUsageByRange(startDate: string, endDate: string): UsageDailyItem[] {
  return db()
    .select({
      date: usageDaily.date,
      publicModel: usageDaily.publicModel,
      requestCount: usageDaily.requestCount,
      promptTokens: usageDaily.promptTokens,
      completionTokens: usageDaily.completionTokens,
      totalTokens: usageDaily.totalTokens
    })
    .from(usageDaily)
    .where(and(gte(usageDaily.date, startDate), lte(usageDaily.date, endDate)))
    .orderBy(asc(usageDaily.date), asc(usageDaily.publicModel))
    .all()
}
