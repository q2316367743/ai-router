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
export const OPENAI_RESPONSES_PATH = '/responses'

/**
 * 上游构建：统一会话 → /responses 报文（即线上口径的请求）。
 * 客户端自定义头经 extraHeaders 附带；content-type 与认证头由本策略自建。
 * 显式 store:false——代理为无状态转发，不把会话留在上游存储。
 * stop 序列 Responses API 不支持，丢弃；assistant 思考历史不回传（非加密 reasoning 项会被上游拒绝）。
 */
export function buildOpenAiResponsesRequest(
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
    input: buildInput(conversation),
    store: false,
    stream: conversation.stream
  }
  if (conversation.system) body['instructions'] = conversation.system
  if (conversation.tools) {
    body['tools'] = conversation.tools.map((tool) => toResponsesTool(tool))
  }
  if (conversation.toolChoice) body['tool_choice'] = toResponsesToolChoice(conversation.toolChoice)
  if (conversation.temperature !== undefined) body['temperature'] = conversation.temperature
  if (conversation.topP !== undefined) body['top_p'] = conversation.topP
  if (conversation.maxOutputTokens !== undefined) {
    body['max_output_tokens'] = conversation.maxOutputTokens
  }
  if (conversation.reasoningEffort) body['reasoning'] = { effort: conversation.reasoningEffort }

  return { url: joinEndpoint(route.providerBaseUrl, OPENAI_RESPONSES_PATH), headers, body }
}

function buildInput(conversation: Conversation): unknown[] {
  const input: unknown[] = []
  for (const item of conversation.messages) {
    if (item.role === 'user') {
      input.push({ role: 'user', content: toUserContent(item.content) })
      continue
    }
    if (item.role === 'assistant') {
      // 空消息（如仅思考历史）不可表达，跳过
      if (!item.content && !item.toolCalls.length) continue
      if (item.content) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: item.content }] })
      }
      for (const call of item.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.toolCallId,
          name: call.toolName,
          arguments: stableArgsJson(call.args)
        })
      }
      continue
    }
    input.push({ type: 'function_call_output', call_id: item.toolCallId, output: item.output })
  }
  return input
}

function toUserContent(content: UserContent): string | unknown[] {
  if (typeof content === 'string') return content
  const parts: unknown[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'input_text', text: part.text })
      continue
    }
    parts.push({ type: 'input_image', image_url: part.url })
  }
  return parts
}

function toResponsesTool(tool: ToolSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: 'function',
    name: tool.name,
    parameters: tool.parameters
  }
  if (tool.description) out['description'] = tool.description
  return out
}

function toResponsesToolChoice(choice: ToolChoice): unknown {
  if (typeof choice === 'string') return choice
  return { type: 'function', name: choice.toolName }
}
