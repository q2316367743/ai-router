import {
  ChatParseError,
  isRecord,
  type Conversation,
  type ConversationMessage,
  type ImagePart,
  type ReasoningEffort,
  type TextPart,
  type ToolChoice,
  type ToolSpec,
  type UserContent
} from '../conversation'

/** 入口解析：/messages 请求体 → 统一会话；不合规结构抛 ChatParseError（→ 400） */
export function parseAnthropicMessagesRequest(body: unknown): Conversation {
  if (!isRecord(body)) throw new ChatParseError('Request body is not valid JSON')
  if (typeof body['model'] !== 'string' || !body['model']) {
    throw new ChatParseError("'model' is required")
  }
  const rawMessages: readonly unknown[] | null = Array.isArray(body['messages'])
    ? (body['messages'] as readonly unknown[])
    : null
  if (!rawMessages || !rawMessages.length) {
    throw new ChatParseError("'messages' array is required")
  }

  let system: string | undefined
  const rawSystem = body['system']
  if (typeof rawSystem === 'string' && rawSystem) system = rawSystem
  else if (Array.isArray(rawSystem)) {
    const text = rawSystem
      .map((item) => (isRecord(item) && typeof item['text'] === 'string' ? item['text'] : ''))
      .filter(Boolean)
      .join('\n\n')
    if (text) system = text
  }

  const messages: ConversationMessage[] = []
  for (const raw of rawMessages) {
    convertMessage(raw, messages)
  }
  if (!messages.length) throw new ChatParseError("'messages' must not be empty")

  const tools = toTools(body['tools'])
  return {
    stream: body['stream'] === true,
    system,
    messages,
    tools,
    toolChoice: toToolChoice(body['tool_choice']),
    temperature: optionalNumber(body['temperature']),
    topP: optionalNumber(body['top_p']),
    maxOutputTokens: optionalNumber(body['max_tokens']),
    stopSequences: toStopSequences(body['stop_sequences']),
    reasoningEffort: toEffort(body['thinking'])
  }
}

type AssistantMessage = Extract<ConversationMessage, { role: 'assistant' }>

function convertMessage(raw: unknown, messages: ConversationMessage[]): void {
  if (!isRecord(raw)) throw new ChatParseError('messages items must be objects')
  const role = raw['role']
  if (role !== 'user' && role !== 'assistant') {
    throw new ChatParseError(`Unsupported message role: ${String(role)}`)
  }
  const content = raw['content']
  if (typeof content === 'string') {
    if (role === 'user') pushUserText(messages, content)
    else pushAssistant(messages, content, [])
    return
  }
  if (!Array.isArray(content)) {
    throw new ChatParseError('message content must be a string or an array of blocks')
  }

  // user：text/image 依序累积为内容块；tool_result 是独立消息
  const parts: Array<TextPart | ImagePart> = []
  // assistant：text 累积为文本，tool_use 聚为工具调用（thinking 历史不回传，忽略）
  let text = ''
  const toolCalls: AssistantMessage['toolCalls'] = []

  const flushUser = (): void => {
    if (!parts.length) return
    pushUserContent(messages, parts.splice(0))
  }

  for (const block of content) {
    if (!isRecord(block)) throw new ChatParseError('content blocks must be objects')
    const type = block['type']
    if (type === 'text' && typeof block['text'] === 'string') {
      if (role === 'user') parts.push({ type: 'text', text: block['text'] })
      else text += block['text']
      continue
    }
    if (role === 'assistant') {
      if (type === 'thinking') {
        continue
      }
      if (type === 'tool_use') {
        const call = parseToolUse(block)
        toolCalls.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          args: call.input
        })
        continue
      }
    }
    if (role === 'user') {
      if (type === 'tool_result') {
        flushUser()
        pushToolResult(messages, block)
        continue
      }
      if (type === 'image') {
        parts.push({ type: 'image_url', url: imageUrl(block) })
        continue
      }
    }
    throw new ChatParseError(`Unsupported content block: ${String(type)}`)
  }
  if (role === 'user') flushUser()
  else pushAssistant(messages, text, toolCalls)
}

/** 纯文本内容合并为字符串（保持上游可见形态），含图片时保留分块结构 */
function pushUserContent(
  messages: ConversationMessage[],
  parts: Array<TextPart | ImagePart>
): void {
  const content: UserContent = parts.every((p) => p.type === 'text')
    ? parts
        .filter((p): p is TextPart => p.type === 'text')
        .map((p) => p.text)
        .join('')
    : parts
  if (typeof content === 'string' && !content) return
  const last = messages.at(-1)
  // 相邻 user 文本合并为一条，避免上游因连续同角色消息报错
  if (typeof content === 'string' && last?.role === 'user' && typeof last.content === 'string') {
    last.content = `${last.content}\n\n${content}`
    return
  }
  messages.push({ role: 'user', content })
}

function pushUserText(messages: ConversationMessage[], text: string): void {
  if (text) pushUserContent(messages, [{ type: 'text', text }])
}

function pushAssistant(
  messages: ConversationMessage[],
  text: string,
  toolCalls: AssistantMessage['toolCalls']
): void {
  if (!text && !toolCalls.length) return // 空消息无需保留
  messages.push({ role: 'assistant', content: text, toolCalls })
}

function parseToolUse(block: Record<string, unknown>): {
  id: string
  name: string
  input: unknown
} {
  const id = typeof block['id'] === 'string' ? block['id'] : ''
  const name = typeof block['name'] === 'string' ? block['name'] : ''
  if (!id || !name) throw new ChatParseError('tool_use block needs id and name')
  return { id, name, input: block['input'] }
}

function pushToolResult(messages: ConversationMessage[], block: Record<string, unknown>): void {
  const id = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : ''
  if (!id) throw new ChatParseError('tool_result block needs tool_use_id')
  const content = block['content']
  const output =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((item) => (isRecord(item) && typeof item['text'] === 'string' ? item['text'] : ''))
            .join('')
        : ''
  messages.push({ role: 'tool_result', toolCallId: id, toolName: 'unknown', output })
}

/** 图片块 → 统一 image_url 表示：base64 source 还原为 data URL，URL source 原样 */
function imageUrl(block: Record<string, unknown>): string {
  const source = isRecord(block['source']) ? block['source'] : null
  if (!source) throw new ChatParseError('image block needs source')
  if (source['type'] === 'base64') {
    const mediaType = typeof source['media_type'] === 'string' ? source['media_type'] : ''
    const data = typeof source['data'] === 'string' ? source['data'] : ''
    if (!mediaType || !data) {
      throw new ChatParseError('image base64 source needs media_type and data')
    }
    return `data:${mediaType};base64,${data}`
  }
  if (typeof source['url'] === 'string') return source['url']
  throw new ChatParseError('Unsupported image source type')
}

function toTools(raw: unknown): ToolSpec[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new ChatParseError('tools must be an array')
  const byName = new Map<string, ToolSpec>()
  for (const item of raw) {
    if (!isRecord(item)) throw new ChatParseError('tools items must be objects')
    const name = typeof item['name'] === 'string' ? item['name'] : ''
    if (!name) throw new ChatParseError('tools item needs name')
    byName.set(name, {
      name,
      description: typeof item['description'] === 'string' ? item['description'] : undefined,
      parameters: isRecord(item['input_schema'])
        ? item['input_schema']
        : { type: 'object', properties: {} }
    })
  }
  return byName.size ? [...byName.values()] : undefined
}

function toToolChoice(raw: unknown): ToolChoice | undefined {
  if (!isRecord(raw)) return undefined
  if (raw['type'] === 'auto') return 'auto'
  if (raw['type'] === 'any') return 'required'
  if (raw['type'] === 'tool' && typeof raw['name'] === 'string') {
    return { type: 'tool', toolName: raw['name'] }
  }
  return undefined
}

function toStopSequences(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const list = raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
    return list.length ? list : undefined
  }
  return undefined
}

/** thinking 预算 → 推理力度（反推有损：≥10000→high、≥4096→medium、其余→low） */
function toEffort(raw: unknown): ReasoningEffort | undefined {
  if (!isRecord(raw) || raw['type'] !== 'enabled') return undefined
  const budget = optionalNumber(raw['budget_tokens'])
  if (budget == null) return undefined
  if (budget >= 10000) return 'high'
  if (budget >= 4096) return 'medium'
  return 'low'
}

function optionalNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}
