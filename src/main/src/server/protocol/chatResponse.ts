import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { LanguageModelUsage } from 'ai'
import type { TokenUsage } from '../proxyLog'
import type { AiFinishReason, ChatFinishReason } from './types'

/** OpenAI Chat 线上格式的 usage 块 */
export interface ChatUsage {
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
  choices: Array<{ index: number; delta: ChunkDelta; finish_reason: ChatFinishReason | null }>
  usage?: ChatUsage
}

interface ChunkDelta {
  role?: 'assistant'
  content?: string
  reasoning_content?: string
  tool_calls?: WireToolCallDelta[]
}

/** ai-sdk 统一 usage → 日志库 TokenUsage（详情字段仅入日志，不改变线上 usage 块格式） */
export function toTokenUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  const prompt = usage?.inputTokens ?? 0
  const completion = usage?.outputTokens ?? 0
  return {
    promptTokens: prompt,
    completionTokens: completion,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    totalTokens: usage?.totalTokens ?? prompt + completion
  }
}

export function toChatUsage(usage: LanguageModelUsage | undefined): ChatUsage {
  const t = toTokenUsage(usage)
  return {
    prompt_tokens: t.promptTokens,
    completion_tokens: t.completionTokens,
    total_tokens: t.totalTokens
  }
}

export function mapFinishReason(reason: AiFinishReason): ChatFinishReason {
  switch (reason) {
    case 'length':
      return 'length'
    case 'tool-calls':
      return 'tool_calls'
    case 'content-filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

export function makeCompletionId(): string {
  return `chatcmpl-${randomUUID()}`
}

/**
 * OpenAI Chat 流式写出器：
 * 响应头惰性写出——首块到来前若发现上游错误，可改用真实状态码返回 JSON 错误。
 * tool-input-start/delta 按增量下发 arguments；未经历增量阶段的完整 tool-call 整段下发。
 */
export interface ChunkWriter {
  readonly headWritten: boolean
  text(delta: string): Promise<void>
  reasoning(delta: string): Promise<void>
  toolInputStart(id: string, name: string): Promise<void>
  toolInputDelta(id: string, delta: string): Promise<void>
  /** 兜底：上游未发出 input-start/delta 时直接下发完整工具调用 */
  toolCallComplete(id: string, name: string, argsJson: string): Promise<void>
  finish(reason: ChatFinishReason, usage: ChatUsage): Promise<void>
  /** 流已开始后中途出错：以 OpenAI 流内 error 块收尾 */
  errorMidStream(message: string): Promise<void>
  end(): void
}

export function createChunkWriter(res: ServerResponse, model: string): ChunkWriter {
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
    finishReason: ChatFinishReason | null,
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

  /** 写出（背压等待 drain） */
  const write = async (line: string): Promise<void> => {
    if (!res.write(line)) {
      await new Promise<void>((resolve) => res.once('drain', resolve))
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
    text: (delta) => send({ content: delta }, null),
    reasoning: (delta) => send({ reasoning_content: delta }, null),
    toolInputStart: async (id, name) => {
      await send(
        {
          tool_calls: [
            { index: toolIndex(id), id, type: 'function', function: { name, arguments: '' } }
          ]
        },
        null
      )
    },
    toolInputDelta: async (id, delta) => {
      await send({ tool_calls: [{ index: toolIndex(id), function: { arguments: delta } }] }, null)
    },
    toolCallComplete: async (id, name, argsJson) => {
      if (toolIndexes.has(id)) return
      await send(
        {
          tool_calls: [
            { index: toolIndex(id), id, type: 'function', function: { name, arguments: argsJson } }
          ]
        },
        null
      )
    },
    finish: async (reason, usage) => {
      await send({}, reason)
      // 末尾独立 usage 块（choices 为空），与 OpenAI include_usage 行为一致
      const tail = envelope()
      tail.choices = []
      tail.usage = usage
      if (!res.writableEnded && !res.destroyed) await write(`data: ${JSON.stringify(tail)}\n\n`)
    },
    errorMidStream: async (message) => {
      if (res.writableEnded || res.destroyed) return
      const line = `data: ${JSON.stringify({ error: { message, type: 'api_error', code: null } })}\n\n`
      await write(line)
    },
    end: () => {
      if (!res.writableEnded && !res.destroyed) {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }
  }
}

/** 非流式成功响应：一次性写出 chat.completion JSON，返回实际写出的正文文本（连接已关闭时为 null） */
export function sendChatCompletion(
  res: ServerResponse,
  args: {
    model: string
    content: string | null
    reasoning: string
    toolCalls: Array<{ id: string; name: string; argsJson: string }>
    finishReason: ChatFinishReason
    usage: ChatUsage
  }
): string | null {
  const message: Record<string, unknown> = { role: 'assistant', content: args.content }
  if (args.reasoning) message['reasoning_content'] = args.reasoning
  if (args.toolCalls.length) {
    message['tool_calls'] = args.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.argsJson }
    }))
  }
  return sendJsonOnce(res, 200, {
    id: makeCompletionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: args.model,
    choices: [{ index: 0, message, finish_reason: args.finishReason }],
    usage: args.usage
  })
}

function sendJsonOnce(res: ServerResponse, status: number, payload: unknown): string | null {
  if (res.writableEnded || res.destroyed) return null
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
  return body
}
