import type { ModelMessage, Tool } from 'ai'

/** 客户端在 OpenAI Chat 请求里可携带的推理力度（reasoning_effort） */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

/** ai-sdk fullStream finish part 的 finishReason 取值 */
export type AiFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'

/** OpenAI Chat 对外暴露的 finish_reason 取值 */
export type ChatFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter'

/** tool_choice（与 ai-sdk ToolChoice 同构，SDK 泛型参数在调用点推导） */
export type ChatToolChoice = 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }

/**
 * 解析产物：字段与 streamText 入参一一对应，由 convertHandler 展开。
 * tools 不带 execute，SDK 只回传工具调用、不执行。
 */
export interface ChatPrompt {
  stream: boolean
  messages: ModelMessage[]
  tools: Record<string, Tool> | undefined
  toolChoice: ChatToolChoice | undefined
  temperature: number | undefined
  topP: number | undefined
  maxOutputTokens: number | undefined
  stopSequences: string[] | undefined
  reasoningEffort: ReasoningEffort | undefined
}

/** 请求体不符合 OpenAI Chat 线上格式（→ 对客户端返回 400） */
export class ChatParseError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
