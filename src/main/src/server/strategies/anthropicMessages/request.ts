import type { MappingRoute } from '$/db/repo/modelRepo'
import { joinEndpoint } from '../../upstream/urls'
import {
  isRecord,
  type Conversation,
  type ConversationMessage,
  type ReasoningEffort,
  type ToolChoice,
  type ToolSpec,
  type UserContent
} from '../conversation'
import type { WireRequest } from '../types'

/** 上游端点路径（该协议作为上游时的固定端点，透传共用） */
export const ANTHROPIC_MESSAGES_PATH = '/messages'

/** Anthropic Messages API 版本（上游要求必带；透传鉴权头同样需要） */
export const ANTHROPIC_VERSION = '2023-06-01'

/** reasoning_effort → Anthropic thinking 预算（budget_tokens 下限 1024；minimal 不启用） */
const THINKING_BUDGET: Partial<Record<ReasoningEffort, number>> = {
  low: 1024,
  medium: 4096,
  high: 10000
}

/** Anthropic Messages 强制要求 max_tokens，客户端未传时的兜底值 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/**
 * 上游构建：统一会话 → /messages 报文（即线上口径的请求）。
 * 客户端自定义头经 extraHeaders 附带；content-type 与认证 / 协议头由本策略自建。
 * 启用 thinking 后 Anthropic 不接受 temperature / top_p，且 max_tokens 必须 > 预算。
 * assistant 的思考历史不回传（signature 不可再造，回传会被上游拒绝）。
 */
export function buildAnthropicMessagesRequest(
  conversation: Conversation,
  route: MappingRoute,
  extraHeaders: Record<string, string>
): WireRequest {
  const headers: Record<string, string> = {
    ...extraHeaders,
    'content-type': 'application/json',
    'x-api-key': route.providerApiKey,
    'anthropic-version': ANTHROPIC_VERSION
  }
  const budget = conversation.reasoningEffort
    ? THINKING_BUDGET[conversation.reasoningEffort]
    : undefined
  let maxTokens = conversation.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  if (budget) maxTokens = Math.max(maxTokens, budget + 1024)

  const body: Record<string, unknown> = {
    model: route.upstreamName,
    max_tokens: maxTokens,
    messages: buildMessages(conversation),
    stream: conversation.stream
  }
  if (conversation.system) body['system'] = conversation.system
  if (budget) body['thinking'] = { type: 'enabled', budget_tokens: budget }
  else {
    if (conversation.temperature !== undefined) body['temperature'] = conversation.temperature
    if (conversation.topP !== undefined) body['top_p'] = conversation.topP
  }
  if (conversation.stopSequences) body['stop_sequences'] = conversation.stopSequences
  if (conversation.tools) body['tools'] = conversation.tools.map(toAnthropicTool)
  const toolChoice = toAnthropicToolChoice(conversation.toolChoice)
  if (toolChoice) body['tool_choice'] = toolChoice

  return { url: joinEndpoint(route.providerBaseUrl, ANTHROPIC_MESSAGES_PATH), headers, body }
}

function buildMessages(conversation: Conversation): unknown[] {
  const messages: unknown[] = []
  for (const item of conversation.messages) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: toUserContent(item.content) })
      continue
    }
    if (item.role === 'assistant') {
      // 空消息（如仅携带思考历史）不可表达为 anthropic 块，跳过
      if (!item.content && !item.toolCalls.length) continue
      messages.push({ role: 'assistant', content: toAssistantBlocks(item) })
      continue
    }
    appendToolResult(messages, item)
  }
  return messages
}

/** tool_result 必须位于 user 消息内：连续结果合并进同一条 user 消息的内容块 */
function appendToolResult(
  messages: unknown[],
  result: Extract<ConversationMessage, { role: 'tool_result' }>
): void {
  const last = messages.at(-1)
  if (isRecord(last) && last['role'] === 'user' && Array.isArray(last['content'])) {
    const content: unknown[] = last['content']
    content.push(toToolResultBlock(result))
    return
  }
  messages.push({ role: 'user', content: [toToolResultBlock(result)] })
}

function toToolResultBlock(
  result: Extract<ConversationMessage, { role: 'tool_result' }>
): Record<string, unknown> {
  return { type: 'tool_result', tool_use_id: result.toolCallId, content: result.output }
}

function toUserContent(content: UserContent): string | unknown[] {
  if (typeof content === 'string') return content
  const blocks: unknown[] = []
  for (const part of content) {
    if (part.type === 'text') {
      // Anthropic 拒绝空 text 块，空文本直接跳过
      if (part.text) blocks.push({ type: 'text', text: part.text })
      continue
    }
    blocks.push({ type: 'image', source: toImageSource(part.url) })
  }
  return blocks
}

/** 图片入参：base64 data URL 还原为 base64 source，其余按 URL source 透传 */
function toImageSource(url: string): Record<string, unknown> {
  const base64 = /^data:([^;]+);base64,([\s\S]+)$/.exec(url)
  if (base64) return { type: 'base64', media_type: base64[1], data: base64[2] }
  return { type: 'url', url }
}

function toAssistantBlocks(item: Extract<ConversationMessage, { role: 'assistant' }>): unknown[] {
  const blocks: unknown[] = []
  if (item.content) blocks.push({ type: 'text', text: item.content })
  for (const call of item.toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: call.toolCallId,
      name: call.toolName,
      input: isRecord(call.args) ? call.args : {}
    })
  }
  return blocks
}

function toAnthropicTool(tool: ToolSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { name: tool.name, input_schema: tool.parameters }
  if (tool.description) out['description'] = tool.description
  return out
}

/** tool_choice 映射：auto→auto、required→any、指定工具→tool；none 无对应取值，退化为不传（模型自主决定） */
function toAnthropicToolChoice(choice: ToolChoice | undefined): Record<string, unknown> | null {
  if (!choice || choice === 'none') return null
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  return { type: 'tool', name: choice.toolName }
}
