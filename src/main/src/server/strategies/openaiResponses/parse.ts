import {
  ChatParseError,
  isRecord,
  type Conversation,
  type ConversationMessage,
  type ReasoningEffort,
  type ImagePart,
  type TextPart,
  type ToolChoice,
  type ToolSpec,
  type UserContent
} from '../conversation'

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

type AssistantMessage = Extract<ConversationMessage, { role: 'assistant' }>

/** 入口解析：/responses 请求体 → 统一会话；不合规结构抛 ChatParseError（→ 400） */
export function parseOpenAiResponsesRequest(body: unknown): Conversation {
  if (!isRecord(body)) throw new ChatParseError('Request body is not valid JSON')
  if (typeof body['model'] !== 'string' || !body['model']) {
    throw new ChatParseError("'model' is required")
  }

  const messages: ConversationMessage[] = []
  const systems: string[] = []
  const rawInstructions = body['instructions']
  if (typeof rawInstructions === 'string' && rawInstructions) systems.push(rawInstructions)

  const rawInput = body['input']
  if (typeof rawInput === 'string') {
    if (rawInput) messages.push({ role: 'user', content: rawInput })
  } else if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      convertItem(item, systems, messages)
    }
  } else if (rawInput != null) {
    throw new ChatParseError("'input' must be a string or an array of items")
  }
  if (!messages.length && !systems.length) {
    throw new ChatParseError("'input' must not be empty")
  }

  const tools = toTools(body['tools'])
  return {
    stream: body['stream'] === true,
    system: systems.length ? systems.join('\n\n') : undefined,
    messages,
    tools,
    toolChoice: toToolChoice(body['tool_choice']),
    temperature: optionalNumber(body['temperature']),
    topP: optionalNumber(body['top_p']),
    maxOutputTokens: optionalNumber(body['max_output_tokens']),
    stopSequences: undefined, // Responses API 无 stop 参数
    reasoningEffort: toEffort(body['reasoning'])
  }
}

function convertItem(raw: unknown, systems: string[], messages: ConversationMessage[]): void {
  if (!isRecord(raw)) throw new ChatParseError('input items must be objects')
  const type = raw['type']
  if (type === 'function_call') {
    const callId = typeof raw['call_id'] === 'string' ? raw['call_id'] : ''
    const name = typeof raw['name'] === 'string' ? raw['name'] : ''
    if (!callId || !name) throw new ChatParseError('function_call item needs call_id and name')
    const args = typeof raw['arguments'] === 'string' ? tryParse(raw['arguments']) : {}
    pushAssistant(messages, '', [{ type: 'tool-call', toolCallId: callId, toolName: name, args }])
    return
  }
  if (type === 'function_call_output') {
    const callId = typeof raw['call_id'] === 'string' ? raw['call_id'] : ''
    if (!callId) throw new ChatParseError('function_call_output item needs call_id')
    const output = typeof raw['output'] === 'string' ? raw['output'] : flattenParts(raw['output'])
    messages.push({ role: 'tool_result', toolCallId: callId, toolName: 'unknown', output })
    return
  }
  if (type === 'reasoning') {
    return // 思考历史不进会话（非加密 reasoning 项回传上游会被拒绝）
  }
  if (type === 'item_reference') {
    throw new ChatParseError('item_reference is not supported (proxy is stateless)')
  }
  // 其余按 message 项处理（{type:'message'} 或直接 {role,content}）
  const role = raw['role']
  if (role === 'system' || role === 'developer') {
    const text = flattenContent(raw['content'])
    if (text) systems.push(text)
    return
  }
  if (role === 'user') {
    const content = toUserContent(raw['content'])
    if (typeof content === 'string' ? content : content.length) {
      messages.push({ role: 'user', content })
    }
    return
  }
  if (role === 'assistant') {
    let text = ''
    let refusal = ''
    const parts = Array.isArray(raw['content']) ? raw['content'] : []
    for (const part of parts) {
      if (!isRecord(part)) continue
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') text += part['text']
      else if (part['type'] === 'refusal' && typeof part['refusal'] === 'string')
        refusal += part['refusal']
    }
    if (text || refusal) pushAssistant(messages, text + refusal, [])
    return
  }
  throw new ChatParseError(`Unsupported input item: ${String(type ?? role)}`)
}

function pushAssistant(
  messages: ConversationMessage[],
  text: string,
  toolCalls: AssistantMessage['toolCalls']
): void {
  const last = messages.at(-1)
  // 相邻 assistant 项合并（function_call 与其文本常相邻出现）
  if (last?.role === 'assistant') {
    if (text) last.content = last.content ? `${last.content}\n\n${text}` : text
    last.toolCalls.push(...toolCalls)
    return
  }
  messages.push({ role: 'assistant', content: text, toolCalls })
}

function toUserContent(content: unknown): UserContent {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return flattenContent(content)
  const parts: Array<TextPart | ImagePart> = []
  for (const item of content) {
    if (!isRecord(item)) throw new ChatParseError('content parts must be objects')
    if (item['type'] === 'input_text' && typeof item['text'] === 'string') {
      parts.push({ type: 'text', text: item['text'] })
      continue
    }
    if (item['type'] === 'input_image') {
      const url = typeof item['image_url'] === 'string' ? item['image_url'] : ''
      if (!url) throw new ChatParseError('input_image part needs image_url')
      parts.push({ type: 'image_url', url })
      continue
    }
    throw new ChatParseError(`Unsupported content part: ${String(item['type'])}`)
  }
  return parts
}

function flattenContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return flattenParts(content)
}

function flattenParts(content: unknown): string {
  if (!Array.isArray(content)) return content == null ? '' : String(content)
  let out = ''
  for (const item of content) {
    if (!isRecord(item)) continue
    if (typeof item['text'] === 'string') out += item['text']
    else if (typeof item['refusal'] === 'string') out += item['refusal']
  }
  return out
}

function toTools(raw: unknown): ToolSpec[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new ChatParseError('tools must be an array')
  const byName = new Map<string, ToolSpec>()
  for (const item of raw) {
    if (!isRecord(item) || item['type'] !== 'function') {
      throw new ChatParseError('only function tools are supported')
    }
    const name = typeof item['name'] === 'string' ? item['name'] : ''
    if (!name) throw new ChatParseError('tools item needs name')
    byName.set(name, {
      name,
      description: typeof item['description'] === 'string' ? item['description'] : undefined,
      parameters: isRecord(item['parameters'])
        ? item['parameters']
        : { type: 'object', properties: {} }
    })
  }
  return byName.size ? [...byName.values()] : undefined
}

function toToolChoice(raw: unknown): ToolChoice | undefined {
  if (raw == null) return undefined
  if (raw === 'auto' || raw === 'none' || raw === 'required') return raw
  if (isRecord(raw) && raw['type'] === 'function' && typeof raw['name'] === 'string') {
    return { type: 'tool', toolName: raw['name'] }
  }
  return undefined
}

function toEffort(raw: unknown): ReasoningEffort | undefined {
  const effort = isRecord(raw) ? raw['effort'] : undefined
  return typeof effort === 'string' && (EFFORTS as readonly string[]).includes(effort)
    ? (effort as ReasoningEffort)
    : undefined
}

function tryParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return json // 模型产出的 arguments 理应为 JSON，异常时保留原文
  }
}

function optionalNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}
