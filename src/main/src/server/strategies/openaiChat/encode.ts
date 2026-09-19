import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { EntryEncoder } from '../types'
import {
  type ApiUsage,
  type Completion,
  type FinishReason,
  type StreamEvent
} from '../conversation'

/** OpenAI Chat 线上格式的 usage 块 */
interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

interface WireToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
}

interface ChunkEnvelope {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{ index: number; delta: ChunkDelta; finish_reason: FinishReason | null }>
  usage?: ChatUsage
}

interface ChunkDelta {
  role?: 'assistant'
  content?: string
  reasoning_content?: string
  tool_calls?: WireToolCallDelta[]
}

/** 线上 usage 块（缺省明细补 0，total 缺省补 prompt+completion） */
function toChatUsage(usage: ApiUsage): ChatUsage {
  const prompt = usage.promptTokens
  const completion = usage.completionTokens
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.totalTokens ?? prompt + completion
  }
}

function makeCompletionId(): string {
  return `chatcmpl-${randomUUID()}`
}

/**
 * chat.completion.chunk 块写出器内部件：
 * 响应头惰性写出——首块到来前若发现上游错误，可改用真实状态码返回 JSON 错误。
 * tool-input-start/delta 按增量下发 arguments；未经历增量阶段的完整 tool-call 整段下发。
 */
function createChunkWriter(res: ServerResponse, model: string) {
  const id = makeCompletionId()
  const created = Math.floor(Date.now() / 1000)
  const toolIndexes = new Map<string, number>()
  let nextIndex = 0
  let headWritten = false

  const envelope = (): ChunkEnvelope => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: []
  })

  const send = async (
    delta: ChunkDelta,
    finishReason: FinishReason | null,
    usage?: ChatUsage
  ): Promise<void> => {
    if (res.writableEnded || res.destroyed) return
    if (!headWritten) {
      headWritten = true
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      const first = envelope()
      first.choices = [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
      await write(`data: ${JSON.stringify(first)}\n\n`)
    }
    const chunk = envelope()
    chunk.choices = [{ index: 0, delta, finish_reason: finishReason }]
    if (usage) chunk.usage = usage
    await write(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  /** 写出（背压等待 drain）：客户端断开后 drain 永不触发，close 兜底放行 */
  const write = async (line: string): Promise<void> => {
    if (res.destroyed || res.writableEnded) return
    if (!res.write(line)) {
      await new Promise<void>((resolve) => {
        res.once('drain', resolve)
        res.once('close', resolve)
      })
    }
  }

  const toolIndex = (id: string): number => {
    const known = toolIndexes.get(id)
    if (known != null) return known
    const index = nextIndex++
    toolIndexes.set(id, index)
    return index
  }

  return {
    get headWritten() {
      return headWritten
    },
    text: (delta: string) => send({ content: delta }, null),
    reasoning: (delta: string) => send({ reasoning_content: delta }, null),
    toolInputStart: (id: string, name: string) =>
      send(
        {
          tool_calls: [
            { index: toolIndex(id), id, type: 'function', function: { name, arguments: '' } }
          ]
        },
        null
      ),
    toolInputDelta: (id: string, delta: string) =>
      send({ tool_calls: [{ index: toolIndex(id), function: { arguments: delta } }] }, null),
    /** 兜底：上游未发出 input-start/delta 增量时整段下发（已下发过则忽略） */
    toolCallComplete: (id: string, name: string, argsJson: string) => {
      if (toolIndexes.has(id)) return Promise.resolve()
      return send(
        {
          tool_calls: [
            { index: toolIndex(id), id, type: 'function', function: { name, arguments: argsJson } }
          ]
        },
        null
      )
    },
    finish: (reason: FinishReason, usage: ChatUsage) => {
      return (async () => {
        await send({}, reason)
        // 末尾独立 usage 块（choices 为空），与 OpenAI include_usage 行为一致
        const tail = envelope()
        tail.choices = []
        tail.usage = usage
        if (!res.writableEnded && !res.destroyed) await write(`data: ${JSON.stringify(tail)}\n\n`)
      })()
    },
    errorMidStream: (message: string) => {
      if (res.writableEnded || res.destroyed) return Promise.resolve()
      const line = `data: ${JSON.stringify({ error: { message, type: 'api_error', code: null } })}\n\n`
      return write(line)
    },
    end: () => {
      if (!res.writableEnded && !res.destroyed) {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }
  }
}

/** 入口编码：统一流事件 → chat.completion.chunk SSE */
export function createOpenAiEntryEncoder(res: ServerResponse, model: string): EntryEncoder {
  const writer = createChunkWriter(res, model)
  return {
    get headWritten() {
      return writer.headWritten
    },
    async write(event: StreamEvent): Promise<void> {
      switch (event.type) {
        case 'text':
          return writer.text(event.delta)
        case 'reasoning':
          return writer.reasoning(event.delta)
        case 'tool-start':
          return writer.toolInputStart(event.id, event.name)
        case 'tool-delta':
          return writer.toolInputDelta(event.id, event.delta)
        case 'tool-complete':
          return writer.toolCallComplete(event.id, event.name, event.argsJson)
        case 'finish':
          return writer.finish(
            event.finishReason,
            toChatUsage(event.usage ?? { promptTokens: 0, completionTokens: 0 })
          )
      }
    },
    writeError: (message: string) => writer.errorMidStream(message),
    end: () => writer.end()
  }
}

/** 入口编码：统一结果 → chat.completion JSON（返回实际写出的正文，连接已关闭为 null） */
export function encodeOpenAiCompletion(
  res: ServerResponse,
  model: string,
  completion: Completion
): string | null {
  const message: Record<string, unknown> = { role: 'assistant', content: completion.content }
  if (completion.reasoning) message['reasoning_content'] = completion.reasoning
  if (completion.toolCalls.length) {
    message['tool_calls'] = completion.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.argsJson || '{}' }
    }))
  }
  if (res.writableEnded || res.destroyed) return null
  const body = JSON.stringify({
    id: makeCompletionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: completion.finishReason }],
    usage: toChatUsage(completion.usage ?? { promptTokens: 0, completionTokens: 0 })
  })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
  return body
}
