/** 单日单模型使用量（永久保留） */
export interface UsageDailyItem {
  /** YYYY-MM-DD */
  date: string
  publicModel: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}
