import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { EntryEncoder } from '../types'
import { type Completion, type StreamEvent } from '../conversation'

function responseId(): string {
  return `resp_${randomUUID().replaceAll('-', '')}`
}

function itemId(prefix: string, n: number): string {
  return `${prefix}_${n.toString(36)}${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

function usageBlock(completion: {
  usage: {
    promptTokens: number
    completionTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    totalTokens?: number
  } | null
}): Record<string, unknown> {
  const usage = completion.usage
  const prompt = usage?.promptTokens ?? 0
  const out = usage?.completionTokens ?? 0
  const cacheRead = usage?.cacheReadTokens ?? 0
  const reasoning = usage?.reasoningTokens ?? 0
  return {
    input_tokens: prompt,
    output_tokens: out,
    total_tokens: usage?.totalTokens ?? prompt + out,
    input_tokens_details: { cached_tokens: cacheRead },
    output_tokens_details: { reasoning_tokens: reasoning }
  }
}

type MessageItem = {
  kind: 'message'
  itemId: string
  index: number
  text: string
  partOpened: boolean
}
type ReasoningItem = { kind: 'reasoning'; itemId: string; index: number; text: string }
type ToolItem = {
  kind: 'tool'
  itemId: string
  index: number
  callId: string
  name: string
  args: string
}

/**
 * 入口编码：统一流事件 → Responses SSE。
 * response.created 惰性发出（首事件前）；message / reasoning / function_call 输出项按需开启，
 * 切换时补 output_item.done；finish 落 response.completed（重建 output 数组并携带 usage）。
 */
export function createResponsesEntryEncoder(res: ServerResponse, model: string): EntryEncoder {
  const respId = responseId()
  const createdAt = Math.floor(Date.now() / 1000)
  let headWritten = false
  let created = false
  let finished = false
  let sequence = 0
  let nextIndex = 0
  let current: MessageItem | ReasoningItem | ToolItem | null = null
  /** 已收口的输出项（重建 response.completed 的 output 数组） */
  const doneItems: Record<string, unknown>[] = []

  const write = async (line: string): Promise<void> => {
    if (res.destroyed || res.writableEnded) return
    if (!res.write(line)) {
      await new Promise<void>((resolve) => {
        res.once('drain', resolve)
        res.once('close', resolve)
      })
    }
  }

  const send = async (data: Record<string, unknown>): Promise<void> => {
    if (!headWritten) {
      headWritten = true
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
    }
    await write(`data: ${JSON.stringify({ sequence_number: sequence++, ...data })}\n\n`)
  }

  const ensureCreated = (): Promise<void> => {
    if (created) return Promise.resolve()
    created = true
    return send({
      type: 'response.created',
      response: {
        id: respId,
        object: 'response',
        created_at: createdAt,
        status: 'in_progress',
        model,
        output: []
      }
    })
  }

  const closeCurrent = (): Promise<void> => {
    const closed = current
    current = null
    if (!closed) return Promise.resolve()
    if (closed.kind === 'message') {
      return (async () => {
        await send({
          type: 'response.content_part.done',
          item_id: closed.itemId,
          output_index: closed.index,
          content_index: 0,
          part: { type: 'output_text', text: closed.text }
        })
        const item = {
          type: 'message',
          id: closed.itemId,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: closed.text, annotations: [] }]
        }
        doneItems.push(item)
        await send({
          type: 'response.output_item.done',
          item_id: closed.itemId,
          output_index: closed.index,
          item
        })
      })()
    }
    if (closed.kind === 'reasoning') {
      const item = {
        type: 'reasoning',
        id: closed.itemId,
        summary: [{ type: 'summary_text', text: closed.text }]
      }
      doneItems.push(item)
      return send({
        type: 'response.output_item.done',
        item_id: closed.itemId,
        output_index: closed.index,
        item
      })
    }
    const item = {
      type: 'function_call',
      id: closed.itemId,
      call_id: closed.callId,
      name: closed.name,
      arguments: closed.args || '{}',
      status: 'completed'
    }
    doneItems.push(item)
    return send({
      type: 'response.output_item.done',
      item_id: closed.itemId,
      output_index: closed.index,
      item
    })
  }

  const ensureMessagePart = (): Promise<string> => {
    if (current?.kind === 'message') {
      return (async () => {
        if (!current.partOpened) {
          current.partOpened = true
          await send({
            type: 'response.content_part.added',
            item_id: current.itemId,
            output_index: current.index,
            content_index: 0,
            part: { type: 'output_text', text: '' }
          })
        }
        return current.itemId
      })()
    }
    return closeCurrent().then(() => {
      const item: MessageItem = {
        kind: 'message',
        itemId: itemId('msg', nextIndex),
        index: nextIndex++,
        text: '',
        partOpened: true
      }
      current = item
      return (async () => {
        await send({
          type: 'response.output_item.added',
          output_index: item.index,
          item: {
            type: 'message',
            id: item.itemId,
            role: 'assistant',
            status: 'in_progress',
            content: []
          }
        })
        await send({
          type: 'response.content_part.added',
          item_id: item.itemId,
          output_index: item.index,
          content_index: 0,
          part: { type: 'output_text', text: '' }
        })
        return item.itemId
      })()
    })
  }

  const ensureReasoningItem = (): Promise<string> => {
    if (current?.kind === 'reasoning') return Promise.resolve(current.itemId)
    return closeCurrent().then(() => {
      const item: ReasoningItem = {
        kind: 'reasoning',
        itemId: itemId('rs', nextIndex),
        index: nextIndex++,
        text: ''
      }
      current = item
      return (async () => {
        await send({
          type: 'response.output_item.added',
          output_index: item.index,
          item: { type: 'reasoning', id: item.itemId, summary: [] }
        })
        return item.itemId
      })()
    })
  }

  const ensureToolItem = async (callId: string, name: string): Promise<ToolItem> => {
    if (current?.kind === 'tool' && current.callId === callId) return current
    await closeCurrent()
    const item: ToolItem = {
      kind: 'tool',
      itemId: itemId('fc', nextIndex),
      index: nextIndex++,
      callId,
      name,
      args: ''
    }
    current = item
    await send({
      type: 'response.output_item.added',
      output_index: item.index,
      item: {
        type: 'function_call',
        id: item.itemId,
        call_id: item.callId,
        name: item.name,
        arguments: '',
        status: 'in_progress'
      }
    })
    return item
  }

  return {
    get headWritten() {
      return headWritten
    },
    async write(event: StreamEvent): Promise<void> {
      if (finished) return
      await ensureCreated()
      switch (event.type) {
        case 'text': {
          const itemIdOut = await ensureMessagePart()
          if (current?.kind === 'message') current.text += event.delta
          await send({
            type: 'response.output_text.delta',
            item_id: itemIdOut,
            output_index: current?.kind === 'message' ? current.index : 0,
            content_index: 0,
            delta: event.delta
          })
          return
        }
        case 'reasoning': {
          const itemIdOut = await ensureReasoningItem()
          if (current?.kind === 'reasoning') current.text += event.delta
          await send({
            type: 'response.reasoning_summary_text.delta',
            item_id: itemIdOut,
            output_index: current?.kind === 'reasoning' ? current.index : 0,
            summary_index: 0,
            delta: event.delta
          })
          return
        }
        case 'tool-start': {
          await closeCurrent()
          await ensureToolItem(event.id, event.name)
          return
        }
        case 'tool-delta': {
          // 未经历 tool-start 的退化路径：added 帧以空名占位
          const item = await ensureToolItem(event.id, '')
          item.args += event.delta
          await send({
            type: 'response.function_call_arguments.delta',
            item_id: item.itemId,
            output_index: item.index,
            delta: event.delta
          })
          return
        }
        case 'tool-complete': {
          const seen = current?.kind === 'tool' && current.callId === event.id
          if (!seen) {
            const item = await ensureToolItem(event.id, event.name)
            if (event.argsJson !== '{}') {
              item.args += event.argsJson
              await send({
                type: 'response.function_call_arguments.delta',
                item_id: item.itemId,
                output_index: item.index,
                delta: event.argsJson
              })
            }
          }
          await closeCurrent()
          return
        }
        case 'finish': {
          await closeCurrent()
          finished = true
          await send({
            type: 'response.completed',
            response: {
              id: respId,
              object: 'response',
              created_at: createdAt,
              status: 'completed',
              model,
              output: doneItems,
              usage: usageBlock({ usage: event.usage })
            }
          })
          return
        }
      }
    },
    async writeError(message: string): Promise<void> {
      if (finished || res.writableEnded || res.destroyed) return
      finished = true
      await send({ type: 'error', code: 'api_error', message, param: null })
    },
    end(): void {
      if (res.writableEnded || res.destroyed) return
      if (!finished) {
        finished = true
        const index = current?.index
        current = null
        if (index != null) {
          res.write(
            `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: index, item: {} })}\n\n`
          )
        }
        res.write(
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              id: respId,
              object: 'response',
              created_at: createdAt,
              status: 'completed',
              model,
              output: doneItems,
              usage: usageBlock({ usage: null })
            }
          })}\n\n`
        )
      }
      res.end()
    }
  }
}

/** 统一结果 → Responses 非流式 JSON 响应（返回实际写出的正文） */
export function encodeResponsesCompletion(
  res: ServerResponse,
  model: string,
  completion: Completion
): string | null {
  if (res.writableEnded || res.destroyed) return null
  const output: Record<string, unknown>[] = []
  if (completion.reasoning) {
    output.push({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: completion.reasoning }]
    })
  }
  output.push({
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: completion.content ?? '', annotations: [] }]
  })
  for (const call of completion.toolCalls) {
    output.push({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: call.argsJson || '{}',
      status: 'completed'
    })
  }
  const body = JSON.stringify({
    id: responseId(),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model,
    output,
    usage: usageBlock(completion)
  })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
  return body
}

/** 入口错误信封：Responses 风格 {error:{code, message}} */
export function writeResponsesError(
  res: ServerResponse,
  status: number,
  message: string,
  code?: string
): string | null {
  if (res.writableEnded || res.destroyed) return null
  const body = JSON.stringify({
    error: {
      code:
        code ??
        (status === 401
          ? 'invalid_api_key'
          : status >= 500
            ? 'api_error'
            : 'invalid_request_error'),
      message,
      param: null
    }
  })
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
  return body
}
