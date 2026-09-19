import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { EntryEncoder } from '../types'
import { isRecord, type Completion, type FinishReason, type StreamEvent } from '../conversation'

/** 统一 finish_reason → Anthropic stop_reason */
function toAnthropicStop(reason: FinishReason): string {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

type ToolBlock = { type: 'tool_use'; index: number; id: string; name: string }
type TextBlock = { type: 'text' | 'thinking'; index: number }

/**
 * 入口编码：统一流事件 → Anthropic Messages SSE。
 * message_start 惰性发出（首事件前）；text / thinking / tool_use 按 content block 管理，
 * 切换块类型时自动补 content_block_stop / start；finish 落 message_delta + message_stop。
 * 限制：message_start.usage.input_tokens 恒 0（流式时序下 usage 在 finish 事件才可知），
 * 输出 token 随 message_delta.usage 下发。
 */
export function createAnthropicEntryEncoder(res: ServerResponse, model: string): EntryEncoder {
  const id = `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  let headWritten = false
  let started = false
  let finished = false
  let current: TextBlock | ToolBlock | null = null
  let nextIndex = 0

  const write = async (line: string): Promise<void> => {
    if (res.destroyed || res.writableEnded) return
    if (!res.write(line)) {
      await new Promise<void>((resolve) => {
        res.once('drain', resolve)
        res.once('close', resolve)
      })
    }
  }

  const send = async (event: string, data: unknown): Promise<void> => {
    if (!headWritten) {
      headWritten = true
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
    }
    await write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const ensureStarted = (): Promise<void> => {
    if (started) return Promise.resolve()
    started = true
    return send('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })
  }

  const closeCurrent = (): Promise<void> => {
    if (!current) return Promise.resolve()
    const index = current.index
    current = null
    return send('content_block_stop', { type: 'content_block_stop', index })
  }

  const ensureTextBlock = (type: 'text' | 'thinking'): Promise<void> => {
    if (current?.type === type) return Promise.resolve()
    return closeCurrent().then(() => {
      const index = nextIndex++
      current = { type, index }
      return send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block:
          type === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }
      })
    })
  }

  const startToolBlock = (toolId: string, name: string): Promise<void> => {
    return closeCurrent().then(() => {
      const index = nextIndex++
      current = { type: 'tool_use', index, id: toolId, name }
      return send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: toolId, name, input: {} }
      })
    })
  }

  return {
    get headWritten() {
      return headWritten
    },
    async write(event: StreamEvent): Promise<void> {
      if (finished) return
      await ensureStarted()
      switch (event.type) {
        case 'text': {
          await ensureTextBlock('text')
          if (!current) return
          await send('content_block_delta', {
            type: 'content_block_delta',
            index: current.index,
            delta: { type: 'text_delta', text: event.delta }
          })
          return
        }
        case 'reasoning': {
          await ensureTextBlock('thinking')
          if (!current) return
          await send('content_block_delta', {
            type: 'content_block_delta',
            index: current.index,
            delta: { type: 'thinking_delta', thinking: event.delta }
          })
          return
        }
        case 'tool-start': {
          await startToolBlock(event.id, event.name)
          return
        }
        case 'tool-delta': {
          const active =
            current?.type === 'tool_use' && current.id === event.id
              ? current
              : await startToolBlock(event.id, '').then(() => current)
          if (!active || active.type !== 'tool_use') return
          await send('content_block_delta', {
            type: 'content_block_delta',
            index: active.index,
            delta: { type: 'input_json_delta', partial_json: event.delta }
          })
          return
        }
        case 'tool-complete': {
          // 增量阶段已交付过 start/delta 的调用由块管理自然收口；未交付过的整段补发
          const seen = current?.type === 'tool_use' && current.id === event.id
          if (!seen) {
            await startToolBlock(event.id, event.name)
            if (current?.type === 'tool_use' && event.argsJson !== '{}') {
              await send('content_block_delta', {
                type: 'content_block_delta',
                index: current.index,
                delta: { type: 'input_json_delta', partial_json: event.argsJson }
              })
            }
          }
          await closeCurrent()
          return
        }
        case 'finish': {
          await closeCurrent()
          finished = true
          await send('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: toAnthropicStop(event.finishReason), stop_sequence: null },
            usage: { output_tokens: event.usage?.completionTokens ?? 0 }
          })
          await send('message_stop', { type: 'message_stop' })
          return
        }
      }
    },
    async writeError(message: string): Promise<void> {
      if (finished || res.writableEnded || res.destroyed) return
      finished = true
      await send('error', { type: 'error', error: { type: 'api_error', message } })
    },
    end(): void {
      if (res.writableEnded || res.destroyed) return
      if (!finished) {
        // 未收到 finish 即收尾（异常中断）：补齐终止帧避免客户端挂起
        finished = true
        const index = current?.index
        current = null
        if (index != null) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index })}\n\n`
          )
        }
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 0 }
          })}\n\n`
        )
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
      }
      res.end()
    }
  }
}

/** 统一结果 → Anthropic message 内容块（最小合法形态：thinking 无 signature） */
function toContentBlocks(completion: Completion): unknown[] {
  const blocks: unknown[] = []
  if (completion.reasoning) blocks.push({ type: 'thinking', thinking: completion.reasoning })
  if (completion.content) blocks.push({ type: 'text', text: completion.content })
  for (const call of completion.toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: safeParse(call.argsJson)
    })
  }
  return blocks
}

function safeParse(json: string): unknown {
  try {
    const parsed: unknown = JSON.parse(json)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 入口编码：统一结果 → /messages 非流式 JSON 响应（返回实际写出的正文） */
export function encodeAnthropicCompletion(
  res: ServerResponse,
  model: string,
  completion: Completion
): string | null {
  if (res.writableEnded || res.destroyed) return null
  const usage = completion.usage
  const cacheRead = usage?.cacheReadTokens ?? 0
  const cacheWrite = usage?.cacheWriteTokens ?? 0
  const body = JSON.stringify({
    id: `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    type: 'message',
    role: 'assistant',
    model,
    content: toContentBlocks(completion),
    stop_reason: toAnthropicStop(completion.finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (usage?.promptTokens ?? 0) - cacheRead - cacheWrite),
      output_tokens: usage?.completionTokens ?? 0,
      ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}),
      ...(cacheWrite ? { cache_creation_input_tokens: cacheWrite } : {})
    }
  })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
  return body
}

/** 入口错误信封：Anthropic 风格 {type:'error', error:{type, message}} */
export function writeAnthropicError(
  res: ServerResponse,
  status: number,
  message: string
): string | null {
  if (res.writableEnded || res.destroyed) return null
  const body = JSON.stringify({
    type: 'error',
    error: {
      type:
        status === 401
          ? 'authentication_error'
          : status >= 500
            ? 'api_error'
            : 'invalid_request_error',
      message
    }
  })
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
  return body
}
