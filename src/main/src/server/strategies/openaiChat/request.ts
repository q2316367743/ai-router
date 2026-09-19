import type { MappingRoute } from '$/db/repo/modelRepo'
import { joinEndpoint } from '../../upstream/urls'
import {
  stableArgsJson,
  type Conversation,
  type ToolChoice,
  type ToolSpec,
  type UserContent
} from '../conversation'
import type { WireRequest } from '../types'

/** 上游端点路径（该协议作为上游时的固定端点，透传共用） */
export const OPENAI_CHAT_PATH = '/chat/completions'

/**
 * 上游构建：统一会话 → /chat/completions 报文（即线上口径的请求）。
 * 客户端自定义头经 extraHeaders 附带，content-type 与认证头由本策略自建。
 * assistant 的思考历史不回传（chat 协议无此概念）。
 */
export function buildOpenAiChatRequest(
  conversation: Conversation,
  route: MappingRoute,
  extraHeaders: Record<string, string>
): WireRequest {
  const headers: Record<string, string> = {
    ...extraHeaders,
    'content-type': 'application/json',
    authorization: `Bearer ${route.providerApiKey}`
  }
  const body: Record<string, unknown> = {
    model: route.upstreamName,
    messages: buildMessages(conversation),
    stream: conversation.stream
  }
  if (conversation.tools) body['tools'] = conversation.tools.map(toOpenAiTool)
  if (conversation.toolChoice) body['tool_choice'] = toOpenAiToolChoice(conversation.toolChoice)
  if (conversation.temperature !== undefined) body['temperature'] = conversation.temperature
  if (conversation.topP !== undefined) body['top_p'] = conversation.topP
  if (conversation.maxOutputTokens !== undefined) body['max_tokens'] = conversation.maxOutputTokens
  if (conversation.stopSequences) body['stop'] = conversation.stopSequences
  if (conversation.reasoningEffort) body['reasoning_effort'] = conversation.reasoningEffort

  return { url: joinEndpoint(route.providerBaseUrl, OPENAI_CHAT_PATH), headers, body }
}

function buildMessages(conversation: Conversation): unknown[] {
  const messages: unknown[] = []
  if (conversation.system) messages.push({ role: 'system', content: conversation.system })
  for (const item of conversation.messages) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: toUserContent(item.content) })
      continue
    }
    if (item.role === 'assistant') {
      // 空消息对 chat 上游不可表达，跳过
      if (!item.content && !item.toolCalls.length) continue
      const message: Record<string, unknown> = { role: 'assistant', content: item.content || null }
      if (item.toolCalls.length) {
        message['tool_calls'] = item.toolCalls.map((call) => ({
          id: call.toolCallId,
          type: 'function',
          function: { name: call.toolName, arguments: stableArgsJson(call.args) }
        }))
      }
      messages.push(message)
      continue
    }
    messages.push({ role: 'tool', tool_call_id: item.toolCallId, content: item.output })
  }
  return messages
}

function toUserContent(content: UserContent): string | unknown[] {
  if (typeof content === 'string') return content
  const parts: unknown[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text })
      continue
    }
    parts.push({ type: 'image_url', image_url: { url: part.url } })
  }
  return parts
}

function toOpenAiTool(tool: ToolSpec): Record<string, unknown> {
  const fn: Record<string, unknown> = { name: tool.name, parameters: tool.parameters }
  if (tool.description) fn['description'] = tool.description
  return { type: 'function', function: fn }
}

function toOpenAiToolChoice(choice: ToolChoice): unknown {
  if (typeof choice === 'string') return choice
  return { type: 'function', function: { name: choice.toolName } }
}
