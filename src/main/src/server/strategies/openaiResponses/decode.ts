import type { SseEvent } from '../sse'
import { isRecord, type ToolCallResult } from '../conversation'
import type { ApiUsage, Completion, FinishReason, StreamEvent } from '../conversation'
import type { UpstreamDecoder, UpstreamFailure } from '../types'

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null
}

/** Responses usage → 统一用量（缓存读 / 思考 token 在 *_details 里，明细分列入库） */
function toApiUsage(raw: unknown): ApiUsage | null {
  if (!isRecord(raw)) return null
  const prompt = toCount(raw['input_tokens'])
  const completion = toCount(raw['output_tokens'])
  const inputDetails = recordField(raw, 'input_tokens_details')
  const outputDetails = recordField(raw, 'output_tokens_details')
  return {
    promptTokens: prompt,
    completionTokens: completion,
    reasoningTokens: toCount(outputDetails?.['reasoning_tokens']),
    cacheReadTokens: toCount(inputDetails?.['cached_tokens']),
    totalTokens: toCount(raw['total_tokens']) || prompt + completion
  }
}

/** 终态 → 统一 finish_reason：截断为 length，出现过工具调用为 tool_calls，其余 stop */
function toFinishReason(response: Record<string, unknown>, hasToolCalls: boolean): FinishReason {
  if (response['status'] === 'incomplete') {
    const details = recordField(response, 'incomplete_details')
    return details?.['reason'] === 'max_output_tokens' ? 'length' : 'stop'
  }
  return hasToolCalls ? 'tool_calls' : 'stop'
}

/** reasoning 输出项的文本：summary[].text + content[].reasoning_text */
function collectReasoningText(item: Record<string, unknown>): string {
  let text = ''
  const summary = Array.isArray(item['summary']) ? item['summary'] : []
  for (const part of summary) {
    if (isRecord(part) && typeof part['text'] === 'string') text += part['text']
  }
  const content = Array.isArray(item['content']) ? item['content'] : []
  for (const part of content) {
    if (isRecord(part) && part['type'] === 'reasoning_text' && typeof part['text'] === 'string') {
      text += part['text']
    }
  }
  return text
}

/** 上游非流式 response JSON → 统一结果 */
export function decodeOpenAiResponsesResponse(payload: unknown): Completion {
  const root = isRecord(payload) ? payload : {}
  let content = ''
  let reasoning = ''
  const toolCalls: ToolCallResult[] = []
  const output = Array.isArray(root['output']) ? root['output'] : []
  for (const item of output) {
    if (!isRecord(item)) continue
    if (item['type'] === 'message') {
      const parts = Array.isArray(item['content']) ? item['content'] : []
      for (const part of parts) {
        if (!isRecord(part)) continue
        if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
          content += part['text']
          continue
        }
        if (part['type'] === 'refusal' && typeof part['refusal'] === 'string') {
          content += part['refusal']
        }
      }
      continue
    }
    if (item['type'] === 'reasoning') {
      reasoning += collectReasoningText(item)
      continue
    }
    if (
      item['type'] === 'function_call' &&
      typeof item['call_id'] === 'string' &&
      typeof item['name'] === 'string'
    ) {
      toolCalls.push({
        id: item['call_id'],
        name: item['name'],
        argsJson: typeof item['arguments'] === 'string' ? item['arguments'] : '{}'
      })
    }
  }
  return {
    content: content || null,
    reasoning,
    toolCalls,
    finishReason: toFinishReason(root, toolCalls.length > 0),
    usage: toApiUsage(root['usage'])
  }
}

/**
 * 上游解码：Responses SSE → 统一流事件（按 data.type 分派）。
 * 文本 / 思考 / 拒答增量；function_call 项（added → arguments.delta → done，item_id 关联 call_id）；
 * response.completed / incomplete 收口，response.failed / error 以流内失败收口。
 */
export function createOpenAiResponsesDecoder(
  onEvent: (event: StreamEvent) => Promise<void>
): UpstreamDecoder {
  let done = false
  let failure: UpstreamFailure | null = null
  let toolSeen = false
  /** function_call 输出项 id（item_id）→ 客户端工具调用 id（call_id） */
  const itemTools = new Map<string, string>()

  const finishWith = async (payload: Record<string, unknown>): Promise<void> => {
    done = true
    const response = recordField(payload, 'response') ?? payload
    await onEvent({
      type: 'finish',
      finishReason: toFinishReason(response, toolSeen),
      usage: toApiUsage(response['usage'])
    })
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
      case 'response.output_text.delta':
        if (typeof payload['delta'] === 'string')
          await onEvent({ type: 'text', delta: payload['delta'] })
        return
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (typeof payload['delta'] === 'string') {
          await onEvent({ type: 'reasoning', delta: payload['delta'] })
        }
        return
      case 'response.refusal.delta':
        if (typeof payload['refusal'] === 'string') {
          await onEvent({ type: 'text', delta: payload['refusal'] })
        }
        return
      case 'response.output_item.added': {
        const item = recordField(payload, 'item')
        if (
          item &&
          item['type'] === 'function_call' &&
          typeof item['id'] === 'string' &&
          typeof item['call_id'] === 'string' &&
          typeof item['name'] === 'string'
        ) {
          toolSeen = true
          itemTools.set(item['id'], item['call_id'])
          await onEvent({ type: 'tool-start', id: item['call_id'], name: item['name'] })
        }
        return
      }
      case 'response.function_call_arguments.delta': {
        const callId =
          typeof payload['item_id'] === 'string' ? itemTools.get(payload['item_id']) : undefined
        if (callId && typeof payload['delta'] === 'string' && payload['delta']) {
          toolSeen = true
          await onEvent({ type: 'tool-delta', id: callId, delta: payload['delta'] })
        }
        return
      }
      case 'response.output_item.done': {
        // 兜底：增量阶段已交付过 start/delta 的调用由入口编码器自行忽略
        const item = recordField(payload, 'item')
        if (
          item &&
          item['type'] === 'function_call' &&
          typeof item['call_id'] === 'string' &&
          typeof item['name'] === 'string'
        ) {
          toolSeen = true
          const args = typeof item['arguments'] === 'string' ? item['arguments'] : '{}'
          await onEvent({
            type: 'tool-complete',
            id: item['call_id'],
            name: item['name'],
            argsJson: args
          })
        }
        return
      }
      case 'response.completed':
      case 'response.incomplete':
        await finishWith(payload)
        return
      case 'response.failed': {
        done = true
        const response = recordField(payload, 'response') ?? payload
        const err = recordField(response, 'error')
        const message = err && typeof err['message'] === 'string' ? err['message'] : 'unknown error'
        failure = { status: 502, message: `Upstream response failed: ${message}` }
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
        return // created / in_progress / content_part.* 等事件
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
