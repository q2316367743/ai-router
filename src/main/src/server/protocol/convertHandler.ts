import { APICallError, streamText } from 'ai'
import type { LanguageModelUsage } from 'ai'
import type { ServerResponse } from 'node:http'
import type { MappingRoute } from '$/db/repo/modelRepo'
import { errMsg, sendOpenAiError } from '../httpRespond'
import { addUsageQuietly, recordLocalLog, type TokenUsage } from '../proxyLog'
import { parseChatPrompt } from './chatRequest'
import {
  createChunkWriter,
  mapFinishReason,
  sendChatCompletion,
  toChatUsage,
  toTokenUsage
} from './chatResponse'
import { planUpstream } from './upstream'
import type { AiFinishReason, ChatPrompt } from './types'

/** streamText 返回结果类型（随 SDK 版本演进，避免手写泛型参数） */
type ChatStreamResult = ReturnType<typeof streamText>

interface ConvertOutcome {
  status: number
  stream: boolean
  usage: TokenUsage | null
  errorSnippet: string | null
  ok: boolean
}

interface UpstreamFailure {
  status: number
  message: string
}

/**
 * 转换转发：客户端为 OpenAI Chat 协议，上游为 anthropic / openai-responses。
 * 请求侧解析为 ai-sdk 统一提示，响应侧把统一流重编码为 OpenAI Chat 线上格式（含 SSE）。
 */
export async function forwardConverted(
  body: unknown,
  res: ServerResponse,
  route: MappingRoute,
  publicModel: string,
  startedAt: number
): Promise<void> {
  const log = (outcome: ConvertOutcome): void => {
    recordLocalLog({
      path: '/v1/chat/completions',
      publicModel,
      providerName: route.providerName,
      upstreamModel: route.upstreamName,
      startedAt,
      status: outcome.status,
      stream: outcome.stream,
      usage: outcome.usage,
      error: outcome.errorSnippet
    })
    if (outcome.ok) addUsageQuietly(publicModel, outcome.usage)
  }

  let prompt: ChatPrompt
  try {
    prompt = parseChatPrompt(body)
  } catch (err) {
    const message = errMsg(err)
    sendOpenAiError(res, 400, message)
    log({ status: 400, stream: false, usage: null, errorSnippet: message, ok: false })
    return
  }

  const plan = planUpstream(route, prompt.reasoningEffort, prompt.maxOutputTokens)
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  let result: ChatStreamResult
  try {
    result = streamText({
      model: plan.model,
      messages: prompt.messages,
      tools: prompt.tools,
      toolChoice: prompt.toolChoice,
      temperature: plan.disableSampling ? undefined : prompt.temperature,
      topP: plan.disableSampling ? undefined : prompt.topP,
      maxOutputTokens: plan.maxOutputTokens,
      stopSequences: prompt.stopSequences,
      providerOptions: plan.thinkingBudget
        ? { anthropic: { thinking: { type: 'enabled', budgetTokens: plan.thinkingBudget } } }
        : plan.reasoningEffort
          ? { openai: { reasoningEffort: plan.reasoningEffort } }
          : undefined,
      abortSignal: controller.signal
    })
  } catch (err) {
    const message = `Invalid chat request: ${errMsg(err)}`
    sendOpenAiError(res, 400, message)
    log({ status: 400, stream: prompt.stream, usage: null, errorSnippet: message, ok: false })
    return
  }

  const outcome = prompt.stream
    ? await streamToClient(res, publicModel, result)
    : await bufferToClient(res, publicModel, result)
  log(outcome)
}

/** 流式：统一流 → chat.completion.chunk SSE */
async function streamToClient(
  res: ServerResponse,
  publicModel: string,
  result: ChatStreamResult
): Promise<ConvertOutcome> {
  const writer = createChunkWriter(res, publicModel)
  let failed: UpstreamFailure | null = null
  let finishReason: AiFinishReason | null = null
  let aborted = false

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          await writer.text(part.text)
          break
        case 'reasoning-delta':
          await writer.reasoning(part.text)
          break
        case 'tool-input-start':
          await writer.toolInputStart(part.id, part.toolName)
          break
        case 'tool-input-delta':
          await writer.toolInputDelta(part.id, part.delta)
          break
        case 'tool-call':
          await writer.toolCallComplete(part.toolCallId, part.toolName, stableJson(part.input))
          break
        case 'finish':
          finishReason = part.finishReason
          break
        case 'abort':
          aborted = true
          break
        case 'error':
          failed = toUpstreamError(part.error)
          break
        default:
          break
      }
      if (aborted || failed) break
    }
  } catch (err) {
    failed = toUpstreamError(err)
  }

  if (aborted) {
    res.destroy()
    return { status: 499, stream: true, usage: null, errorSnippet: 'client aborted', ok: false }
  }
  if (failed) {
    if (writer.headWritten) {
      await writer.errorMidStream(failed.message)
      writer.end()
    } else {
      sendOpenAiError(res, failed.status, failed.message)
    }
    return { status: failed.status, stream: true, usage: null, errorSnippet: failed.message, ok: false }
  }

  let usage: LanguageModelUsage | undefined
  try {
    usage = await result.usage
    await writer.finish(mapFinishReason(finishReason ?? (await result.finishReason)), toChatUsage(usage))
  } catch (err) {
    // usage/finishReason 收尾失败不掩盖已下发正文，以流内错误块收尾
    failed = toUpstreamError(err)
    await writer.errorMidStream(failed.message)
  }
  writer.end()
  return {
    status: failed ? failed.status : 200,
    stream: true,
    usage: usage ? toTokenUsage(usage) : null,
    errorSnippet: failed ? failed.message : null,
    ok: !failed
  }
}

/** 非流式：消费统一流聚合为完整 chat.completion */
async function bufferToClient(
  res: ServerResponse,
  publicModel: string,
  result: ChatStreamResult
): Promise<ConvertOutcome> {
  let text = ''
  let reasoning = ''
  let failed: UpstreamFailure | null = null
  let finishReason: AiFinishReason | null = null
  let aborted = false
  const toolCalls: Array<{ id: string; name: string; argsJson: string }> = []

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text
          break
        case 'reasoning-delta':
          reasoning += part.text
          break
        case 'tool-call':
          toolCalls.push({ id: part.toolCallId, name: part.toolName, argsJson: stableJson(part.input) })
          break
        case 'finish':
          finishReason = part.finishReason
          break
        case 'abort':
          aborted = true
          break
        case 'error':
          failed = toUpstreamError(part.error)
          break
        default:
          break
      }
      if (aborted || failed) break
    }
  } catch (err) {
    failed = toUpstreamError(err)
  }

  if (aborted) {
    return { status: 499, stream: false, usage: null, errorSnippet: 'client aborted', ok: false }
  }
  if (failed) {
    sendOpenAiError(res, failed.status, failed.message)
    return { status: failed.status, stream: false, usage: null, errorSnippet: failed.message, ok: false }
  }

  let usage: LanguageModelUsage | undefined
  try {
    usage = await result.usage
  } catch (err) {
    failed = toUpstreamError(err)
    sendOpenAiError(res, failed.status, failed.message)
    return { status: failed.status, stream: false, usage: null, errorSnippet: failed.message, ok: false }
  }
  sendChatCompletion(res, {
    model: publicModel,
    content: text || null,
    reasoning,
    toolCalls,
    finishReason: mapFinishReason(finishReason ?? 'stop'),
    usage: toChatUsage(usage)
  })
  return { status: 200, stream: false, usage: toTokenUsage(usage), errorSnippet: null, ok: true }
}

/** 上游错误 → 客户端状态码与消息（ai-sdk 网络错误带 statusCode，其余按 502 处理） */
function toUpstreamError(err: unknown): UpstreamFailure {
  if (APICallError.isInstance(err)) {
    const body = typeof err.responseBody === 'string' && err.responseBody ? `: ${err.responseBody.slice(0, 300)}` : ''
    return { status: err.statusCode ?? 502, message: `${err.message}${body}` }
  }
  return { status: 502, message: `Upstream request failed: ${errMsg(err)}` }
}

/** 工具调用入参序列化：对象转 JSON 字符串，字符串视为已是 JSON 文本 */
function stableJson(input: unknown): string {
  if (typeof input === 'string') return input
  if (input == null) return '{}'
  return JSON.stringify(input)
}
