import { jsonSchema, tool } from 'ai'
import type { ModelMessage, Tool } from 'ai'
import {
  ChatParseError,
  isRecord,
  type ChatPrompt,
  type ChatToolChoice,
  type ReasoningEffort
} from './types'

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

/** 把 OpenAI Chat 请求体解析为 ai-sdk 提示与参数；不合规结构抛 ChatParseError（→ 400） */
export function parseChatPrompt(body: unknown): ChatPrompt {
  if (!isRecord(body)) throw new ChatParseError('Request body is not valid JSON')
  if (typeof body['model'] !== 'string' || !body['model']) {
    throw new ChatParseError("'model' is required")
  }
  const rawMessages: readonly unknown[] | null = Array.isArray(body['messages'])
    ? (body['messages'] as readonly unknown[])
    : null
  if (!rawMessages) throw new ChatParseError("'messages' array is required")
  if (typeof body['n'] === 'number' && body['n'] > 1) {
    throw new ChatParseError('Only n=1 is supported')
  }

  const messages: ModelMessage[] = []
  const systems: string[] = []
  // tool_call_id → 工具名：补全 role:'tool' 消息必需的 toolName
  const toolNames = new Map<string, string>()
  for (const raw of rawMessages) {
    convertMessage(raw, toolNames, systems, messages)
  }
  if (!messages.length && !systems.length) {
    throw new ChatParseError("'messages' must not be empty")
  }

  const tools = toTools(body['tools'])
  return {
    stream: body['stream'] === true,
    messages: systems.length
      ? [{ role: 'system', content: systems.join('\n\n') }, ...messages]
      : messages,
    tools,
    toolChoice: toToolChoice(body['tool_choice'], tools),
    temperature: optionalNumber(body['temperature']),
    topP: optionalNumber(body['top_p']),
    maxOutputTokens:
      optionalNumber(body['max_completion_tokens']) ?? optionalNumber(body['max_tokens']),
    stopSequences: toStopSequences(body['stop']),
    reasoningEffort: toEffort(body['reasoning_effort'])
  }
}

function convertMessage(
  raw: unknown,
  toolNames: Map<string, string>,
  systems: string[],
  messages: ModelMessage[]
): void {
  if (!isRecord(raw)) throw new ChatParseError('messages items must be objects')
  const role = raw['role']
  if (role === 'system' || role === 'developer') {
    const text = flattenText(raw['content'])
    if (text) systems.push(text)
    return
  }
  if (role === 'user') {
    messages.push({ role: 'user', content: convertUserContent(raw['content']) })
    return
  }
  if (role === 'assistant') {
    convertAssistant(raw, toolNames, messages)
    return
  }
  if (role === 'tool') {
    convertToolResult(raw, toolNames, messages)
    return
  }
  throw new ChatParseError(`Unsupported message role: ${String(role)}`)
}

function convertAssistant(
  raw: Record<string, unknown>,
  toolNames: Map<string, string>,
  messages: ModelMessage[]
): void {
  const text = flattenText(raw['content'])
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = []
  if (text) parts.push({ type: 'text', text })

  const calls = Array.isArray(raw['tool_calls']) ? raw['tool_calls'] : []
  for (const item of calls) {
    const call = parseToolCall(item)
    toolNames.set(call.id, call.name)
    parts.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.input })
  }
  if (!parts.length) throw new ChatParseError('assistant message needs content or tool_calls')
  messages.push({ role: 'assistant', content: parts })
}

function parseToolCall(raw: unknown): { id: string; name: string; input: unknown } {
  if (!isRecord(raw)) throw new ChatParseError('tool_calls items must be objects')
  const id = typeof raw['id'] === 'string' ? raw['id'] : ''
  const fn = isRecord(raw['function']) ? raw['function'] : null
  const name = fn && typeof fn['name'] === 'string' ? fn['name'] : ''
  if (!id || !name) throw new ChatParseError('tool_call needs id and function.name')
  const args = fn && typeof fn['arguments'] === 'string' ? fn['arguments'] : ''
  let input: unknown = {}
  try {
    input = args ? JSON.parse(args) : {}
  } catch {
    throw new ChatParseError(`tool_call '${name}' arguments is not valid JSON`)
  }
  return { id, name, input }
}

function convertToolResult(
  raw: Record<string, unknown>,
  toolNames: Map<string, string>,
  messages: ModelMessage[]
): void {
  const id = typeof raw['tool_call_id'] === 'string' ? raw['tool_call_id'] : ''
  if (!id) throw new ChatParseError('tool message needs tool_call_id')
  messages.push({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: toolNames.get(id) ?? 'unknown',
        output: { type: 'text', value: flattenText(raw['content']) }
      }
    ]
  })
}

function convertUserContent(
  content: unknown
): string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> {
  if (!Array.isArray(content)) return flattenText(content)
  return content.map((item: unknown) => {
    if (!isRecord(item)) throw new ChatParseError('content parts must be objects')
    if (item['type'] === 'text' && typeof item['text'] === 'string') {
      return { type: 'text' as const, text: item['text'] }
    }
    if (item['type'] === 'image_url') {
      const holder = item['image_url']
      const url =
        typeof holder === 'string'
          ? holder
          : isRecord(holder) && typeof holder['url'] === 'string'
            ? holder['url']
            : ''
      if (!url) throw new ChatParseError('image_url part needs url')
      return { type: 'image' as const, image: url }
    }
    throw new ChatParseError(`Unsupported content part: ${String(item['type'])}`)
  })
}

/** system/user 消息的 content 兼容字符串与分段数组，统一拍平为纯文本 */
function flattenText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let out = ''
    for (const item of content) {
      if (isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string') {
        out += item['text']
      }
    }
    return out
  }
  return String(content)
}

function toTools(raw: unknown): Record<string, Tool> | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new ChatParseError('tools must be an array')
  const tools: Record<string, Tool> = {}
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item['function'])) {
      throw new ChatParseError('tools items must be function tools')
    }
    const fn = item['function']
    const name = typeof fn['name'] === 'string' ? fn['name'] : ''
    if (!name) throw new ChatParseError('tools item needs function.name')
    tools[name] = tool({
      description: typeof fn['description'] === 'string' ? fn['description'] : undefined,
      inputSchema: jsonSchema(
        (isRecord(fn['parameters'])
          ? fn['parameters']
          : { type: 'object', properties: {} }) as Parameters<typeof jsonSchema>[0]
      )
    })
  }
  return Object.keys(tools).length ? tools : undefined
}

function toToolChoice(
  raw: unknown,
  tools: Record<string, Tool> | undefined
): ChatToolChoice | undefined {
  if (!tools) return undefined
  if (raw == null || raw === 'auto') return 'auto'
  if (raw === 'none' || raw === 'required') return raw
  if (
    isRecord(raw) &&
    raw['type'] === 'function' &&
    isRecord(raw['function']) &&
    typeof raw['function']['name'] === 'string'
  ) {
    return { type: 'tool', toolName: raw['function']['name'] }
  }
  return 'auto'
}

function toStopSequences(raw: unknown): string[] | undefined {
  if (typeof raw === 'string' && raw) return [raw]
  if (Array.isArray(raw)) {
    const list = raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
    return list.length ? list : undefined
  }
  return undefined
}

function toEffort(raw: unknown): ReasoningEffort | undefined {
  return typeof raw === 'string' && (EFFORTS as readonly string[]).includes(raw)
    ? (raw as ReasoningEffort)
    : undefined
}

function optionalNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}
