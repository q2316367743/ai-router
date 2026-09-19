import type { UpstreamDecoder } from '../types'
import type { SseEvent } from '../sse'
import { isRecord, stableArgsJson, type ToolCallResult } from '../conversation'
import type { ApiUsage, Completion, FinishReason, StreamEvent } from '../conversation'
import type { UpstreamFailure } from '../types'

/** stop_reason → 统一 finish_reason（end_turn / stop_sequence 归为 stop） */
function toFinishReason(reason: unknown): FinishReason {
  switch (reason) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'refusal':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * Anthropic usage → 统一用量。Anthropic 的 input_tokens 不含缓存部分，缓存读 / 写单独上报；
 * prompt = 主输入 + 缓存读 + 缓存写（明细分列入库），与 openai 透传口径一致。
 */
function toApiUsage(raw: unknown): ApiUsage | null {
  if (!isRecord(raw)) return null
  const cacheRead = toCount(raw['cache_read_input_tokens'])
  const cacheWrite = toCount(raw['cache_creation_input_tokens'])
  const prompt = toCount(raw['input_tokens']) + cacheRead + cacheWrite
  const completion = toCount(raw['output_tokens'])
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: prompt + completion
  }
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null
}

/** 上游非流式 message JSON → 统一结果 */
export function decodeAnthropicResponse(payload: unknown): Completion {
  const root = isRecord(payload) ? payload : {}
  let text = ''
  let reasoning = ''
  const toolCalls: ToolCallResult[] = []
  const blocks = Array.isArray(root['content']) ? root['content'] : []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      text += block['text']
      continue
    }
    if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
      reasoning += block['thinking']
      continue
    }
    if (
      block['type'] === 'tool_use' &&
      typeof block['id'] === 'string' &&
      typeof block['name'] === 'string'
    ) {
      toolCalls.push({
        id: block['id'],
        name: block['name'],
        argsJson: stableArgsJson(block['input'])
      })
    }
  }
  return {
    content: text || null,
    reasoning,
    toolCalls,
    finishReason: toFinishReason(root['stop_reason']),
    usage: toApiUsage(root['usage'])
  }
}

/**
 * 上游解码：Anthropic Messages SSE → 统一流事件。
 * message_start（输入 usage）→ content_block_start/delta/stop（text / thinking / tool_use）→
 * message_delta（stop_reason + 输出 usage）→ message_stop；event:error 以流内失败收口。
 */
export function createAnthropicDecoder(
  onEvent: (event: StreamEvent) => Promise<void>
): UpstreamDecoder {
  let done = false
  let failure: UpstreamFailure | null = null
  let finishReason: FinishReason = 'stop'
  let inputUsage: ApiUsage | null = null
  let outputTokens = 0
  /** block index → 工具调用（input_json_delta 只带 index，不带 id） */
  const blockTools = new Map<number, { id: string; name: string }>()
  /** block index → 已累积的 partial_json（block stop 时整段兜底交付） */
  const blockArgs = new Map<number, string>()

  const mergeUsage = (): ApiUsage | null => {
    if (!inputUsage && !outputTokens) return null
    const prompt = inputUsage?.promptTokens ?? 0
    const completion = outputTokens || inputUsage?.completionTokens || 0
    return {
      promptTokens: prompt,
      completionTokens: completion,
      cacheReadTokens: inputUsage?.cacheReadTokens ?? 0,
      cacheWriteTokens: inputUsage?.cacheWriteTokens ?? 0,
      totalTokens: prompt + completion
    }
  }

  const handleBlockStart = async (payload: Record<string, unknown>): Promise<void> => {
    const block = recordField(payload, 'content_block')
    if (!block) return
    if (
      block['type'] === 'tool_use' &&
      typeof block['id'] === 'string' &&
      typeof block['name'] === 'string'
    ) {
      const index = toCount(payload['index'])
      blockTools.set(index, { id: block['id'], name: block['name'] })
      blockArgs.set(index, '')
      await onEvent({ type: 'tool-start', id: block['id'], name: block['name'] })
    }
  }

  const handleBlockDelta = async (payload: Record<string, unknown>): Promise<void> => {
    const delta = recordField(payload, 'delta')
    if (!delta) return
    if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      await onEvent({ type: 'text', delta: delta['text'] })
      return
    }
    if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
      await onEvent({ type: 'reasoning', delta: delta['thinking'] })
      return
    }
    if (delta['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
      const index = toCount(payload['index'])
      blockArgs.set(index, (blockArgs.get(index) ?? '') + delta['partial_json'])
      const tool = blockTools.get(index)
      if (tool) await onEvent({ type: 'tool-delta', id: tool.id, delta: delta['partial_json'] })
    }
  }

  const handleBlockStop = async (payload: Record<string, unknown>): Promise<void> => {
    const index = toCount(payload['index'])
    const tool = blockTools.get(index)
    if (!tool) return
    // 兜底：增量阶段已交付过 start/delta 的调用由入口编码器自行忽略
    await onEvent({
      type: 'tool-complete',
      id: tool.id,
      name: tool.name,
      argsJson: blockArgs.get(index) || '{}'
    })
  }

  const handleMessageDelta = (payload: Record<string, unknown>): void => {
    const delta = recordField(payload, 'delta')
    if (delta && delta['stop_reason'] != null) finishReason = toFinishReason(delta['stop_reason'])
    const usage = recordField(payload, 'usage')
    if (usage) outputTokens = toCount(usage['output_tokens'])
  }

  const handleEvent = async (event: SseEvent): Promise<void> => {
    if (done) return
    let payload: unknown
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    if (!isRecord(payload)) return
    switch (payload['type']) {
      case 'message_start':
        inputUsage = toApiUsage(recordField(payload, 'message')?.['usage'])
        return
      case 'content_block_start':
        await handleBlockStart(payload)
        return
      case 'content_block_delta':
        await handleBlockDelta(payload)
        return
      case 'content_block_stop':
        await handleBlockStop(payload)
        return
      case 'message_delta':
        handleMessageDelta(payload)
        return
      case 'message_stop': {
        done = true
        await onEvent({ type: 'finish', finishReason, usage: mergeUsage() })
        return
      }
      case 'error': {
        done = true
        const err = recordField(payload, 'error') ?? payload
        const message = typeof err['message'] === 'string' ? err['message'] : 'unknown error'
        failure = { status: 502, message: `Upstream stream error: ${message}` }
        return
      }
      default:
        return // ping 等其他事件
    }
  }

  return {
    handleEvent,
    flush: () => Promise.resolve(),
    get done() {
      return done
    },
    get completed() {
      return done && failure === null
    },
    get failure() {
      return failure
    }
  }
}
