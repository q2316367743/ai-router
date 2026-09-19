/**
 * 统一会话与流事件：所有协议共用的中性枢纽。
 * 每个协议策略把「自己协议的线上格式」双向映射到这里的类型——
 * 入口方向 parse（请求体 → Conversation）/ encode（Completion·StreamEvent → 响应），
 * 上游方向 request（Conversation → 报文）/ decode（响应 → Completion·StreamEvent）。
 */
import type { TokenUsage } from '../logging/requestLog'

/** 请求里可携带的推理力度（reasoning_effort 词汇） */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

/** 统一 finish_reason 词表（各协议自行映射到自己的线上取值） */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter'

export interface TextPart {
  type: 'text'
  text: string
}

export interface ImagePart {
  type: 'image_url'
  /** data URL（data:image/png;base64,…）或 http(s) URL */
  url: string
}

export interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  /** 已校验的 JSON 入参（对象/标量均可），策略侧按协议自行序列化 */
  args: unknown
}

export interface ToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: string
}

export type UserContent = string | Array<TextPart | ImagePart>

export type ConversationMessage =
  | { role: 'user'; content: UserContent }
  | { role: 'assistant'; content: string; toolCalls: ToolCallPart[] }
  | { role: 'tool_result'; toolCallId: string; toolName: string; output: string }

export interface ToolSpec {
  name: string
  description: string | undefined
  /** JSON Schema 对象 */
  parameters: Record<string, unknown>
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }

export interface Conversation {
  stream: boolean
  /** system 消息合并文本（\n\n 连接）；无则为 undefined */
  system: string | undefined
  messages: ConversationMessage[]
  tools: ToolSpec[] | undefined
  toolChoice: ToolChoice | undefined
  temperature: number | undefined
  topP: number | undefined
  maxOutputTokens: number | undefined
  stopSequences: string[] | undefined
  reasoningEffort: ReasoningEffort | undefined
}

/** 提供商上报的统一用量（各协议解码器从线上 usage 归一而来；明细可缺省） */
export interface ApiUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
}

export interface ToolCallResult {
  id: string
  name: string
  argsJson: string
}

/** 统一完成结果（非流式解码产物 / 流式 finish 事件的载荷） */
export interface Completion {
  content: string | null
  reasoning: string
  toolCalls: ToolCallResult[]
  finishReason: FinishReason
  usage: ApiUsage | null
}

/** 统一流事件（上游解码产出 → 入口编码消费） */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-start'; id: string; name: string }
  | { type: 'tool-delta'; id: string; delta: string }
  | { type: 'tool-complete'; id: string; name: string; argsJson: string }
  | { type: 'finish'; finishReason: FinishReason; usage: ApiUsage | null }

/** 请求体不符合所在协议的线上格式（→ 对客户端 400） */
export class ChatParseError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 工具调用入参序列化：对象转 JSON 字符串，字符串视为已是 JSON 文本 */
export function stableArgsJson(args: unknown): string {
  if (typeof args === 'string') return args
  if (args == null) return '{}'
  return JSON.stringify(args)
}

/** 统一用量 → 日志库 TokenUsage（缺省明细补 0，total 缺省补 prompt+completion） */
export function toTokenUsage(usage: ApiUsage): TokenUsage {
  const prompt = usage.promptTokens
  const completion = usage.completionTokens
  return {
    promptTokens: prompt,
    completionTokens: completion,
    reasoningTokens: usage.reasoningTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens ?? prompt + completion
  }
}
