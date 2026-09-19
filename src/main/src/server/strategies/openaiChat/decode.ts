import type { UpstreamDecoder } from '../types'
import {
  isRecord,
  type ApiUsage,
  type Completion,
  type FinishReason,
  type StreamEvent,
  type ToolCallResult
} from '../conversation'

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 线上 usage → 统一用量（明细字段兼容 DeepSeek/缓存明细与 Anthropic 风格兜底字段） */
function toApiUsage(raw: unknown): ApiUsage | null {
  if (!isRecord(raw)) return null
  const prompt = toCount(raw['prompt_tokens'])
  const completion = toCount(raw['completion_tokens'])
  const promptDetails = isRecord(raw['prompt_tokens_details']) ? raw['prompt_tokens_details'] : {}
  const completionDetails = isRecord(raw['completion_tokens_details'])
    ? raw['completion_tokens_details']
    : {}
  return {
    promptTokens: prompt,
    completionTokens: completion,
    reasoningTokens:
      toCount(completionDetails['reasoning_tokens']) || toCount(raw['reasoning_tokens']),
    cacheReadTokens:
      toCount(promptDetails['cached_tokens']) || toCount(raw['cache_read_input_tokens']),
    cacheWriteTokens: toCount(raw['cache_creation_input_tokens']),
    totalTokens: toCount(raw['total_tokens']) || prompt + completion
  }
}

function toFinishReason(raw: unknown): FinishReason {
  return raw === 'length' || raw === 'tool_calls' || raw === 'content_filter' ? raw : 'stop'
}

/** 上游非流式 JSON → 统一结果（宽松：结构不识别返回空结果，供透传抽 usage 复用） */
export function decodeOpenAiChatResponse(payload: unknown): Completion {
  const root = isRecord(payload) ? payload : {}
  const choice =
    Array.isArray(root['choices']) && isRecord(root['choices'][0]) ? root['choices'][0] : {}
  const message = isRecord(choice['message']) ? choice['message'] : {}
  const toolCalls: ToolCallResult[] = []
  const rawCalls = Array.isArray(message['tool_calls']) ? message['tool_calls'] : []
  for (const call of rawCalls) {
    if (!isRecord(call)) continue
    const fn = isRecord(call['function']) ? call['function'] : {}
    if (typeof call['id'] === 'string' && typeof fn['name'] === 'string') {
      toolCalls.push({
        id: call['id'],
        name: fn['name'],
        argsJson: typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}'
      })
    }
  }
  return {
    content: typeof message['content'] === 'string' ? message['content'] : null,
    reasoning: typeof message['reasoning_content'] === 'string' ? message['reasoning_content'] : '',
    toolCalls,
    finishReason: toFinishReason(choice['finish_reason']),
    usage: toApiUsage(root['usage'])
  }
}

/**
 * 上游解码：chat.completion.chunk SSE → 统一流事件。
 * finish_reason 与 usage 尾块在 [DONE] / 流末合成 finish（usage 块在 finish_reason 之后到达）。
 */
export function createOpenAiChatDecoder(
  onEvent: (event: StreamEvent) => Promise<void>
): UpstreamDecoder {
  let done = false
  let completed = false
  let finishReason: FinishReason | null = null
  let usage: ApiUsage | null = null
  /** delta.tool_calls 的 index → 工具调用（id/name 可能分片到达，聚齐后才发 tool-start） */
  const tools = new Map<number, { id: string; name: string; started: boolean }>()

  const emitFinish = async (): Promise<void> => {
    if (done) return
    done = true
    completed = true
    await onEvent({ type: 'finish', finishReason: finishReason ?? 'stop', usage })
  }

  const handleDelta = async (delta: Record<string, unknown>): Promise<void> => {
    if (typeof delta['content'] === 'string' && delta['content']) {
      await onEvent({ type: 'text', delta: delta['content'] })
    }
    if (typeof delta['reasoning_content'] === 'string' && delta['reasoning_content']) {
      await onEvent({ type: 'reasoning', delta: delta['reasoning_content'] })
    }
    const calls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : []
    for (const raw of calls) {
      if (!isRecord(raw)) continue
      const index = toCount(raw['index'])
      const fn = isRecord(raw['function']) ? raw['function'] : {}
      let tool = tools.get(index)
      if (!tool) {
        tool = { id: '', name: '', started: false }
        tools.set(index, tool)
      }
      if (typeof raw['id'] === 'string' && !tool.id) tool.id = raw['id']
      if (typeof fn['name'] === 'string' && !tool.name) tool.name = fn['name']
      if (!tool.started && tool.id && tool.name) {
        tool.started = true
        await onEvent({ type: 'tool-start', id: tool.id, name: tool.name })
      }
      if (tool.started && typeof fn['arguments'] === 'string' && fn['arguments']) {
        await onEvent({ type: 'tool-delta', id: tool.id, delta: fn['arguments'] })
      }
    }
  }

  const handleEvent = async (data: string): Promise<void> => {
    if (done) return
    if (data.trim() === '[DONE]') {
      await emitFinish()
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(payload)) return
    const harvested = toApiUsage(payload['usage'])
    if (harvested) usage = harvested
    const choices = Array.isArray(payload['choices']) ? payload['choices'] : []
    const choice = isRecord(choices[0]) ? choices[0] : null
    if (!choice) return
    if (choice['finish_reason'] != null) finishReason = toFinishReason(choice['finish_reason'])
    const delta = isRecord(choice['delta']) ? choice['delta'] : null
    if (delta) await handleDelta(delta)
  }

  return {
    handleEvent: (event) => handleEvent(event.data),
    flush: () => {
      // 有 finish_reason 但缺 [DONE]（部分兼容网关）时在流末补 finish；无 finish_reason 属异常中断
      return finishReason != null ? emitFinish() : Promise.resolve()
    },
    get done() {
      return done
    },
    get completed() {
      return completed
    },
    get failure() {
      return null
    }
  }
}
