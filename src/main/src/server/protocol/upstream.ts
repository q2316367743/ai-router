import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { MappingRoute } from '$/db/repo/modelRepo'
import type { ReasoningEffort } from './types'
import { normalizeBaseUrl } from './upstreamUrl'

/** reasoning_effort → Anthropic thinking 预算（budgetTokens 下限 1024） */
const THINKING_BUDGET: Partial<Record<ReasoningEffort, number>> = {
  low: 1024,
  medium: 4096,
  high: 10000
}

/** Anthropic Messages 强制要求 max_tokens，客户端未传时的兜底值 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** 转换路径的上游执行计划（provider 专属参数由调用点内联进 streamText） */
export interface UpstreamPlan {
  model: LanguageModel
  /** Anthropic thinking 预算（启用时非空） */
  thinkingBudget: number | undefined
  /** OpenAI Responses 推理力度（设置时非空） */
  reasoningEffort: ReasoningEffort | undefined
  /** 启用 thinking 后 Anthropic 不接受自定义采样参数 */
  disableSampling: boolean
  maxOutputTokens: number | undefined
}

/**
 * 按提供商协议构造 ai-sdk 模型实例与 provider 专属参数
 * （extraHeaders 随请求透传上游；fetchImpl 供线上请求/响应捕获注入）
 */
export function planUpstream(
  route: MappingRoute,
  effort: ReasoningEffort | undefined,
  clientMaxOutputTokens: number | undefined,
  extraHeaders: Record<string, string>,
  fetchImpl?: typeof fetch
): UpstreamPlan {
  if (route.providerProtocol === 'anthropic') {
    return planAnthropic(route, effort, clientMaxOutputTokens, extraHeaders, fetchImpl)
  }
  return planResponses(route, effort, clientMaxOutputTokens, extraHeaders, fetchImpl)
}

function planAnthropic(
  route: MappingRoute,
  effort: ReasoningEffort | undefined,
  clientMax: number | undefined,
  extraHeaders: Record<string, string>,
  fetchImpl: typeof fetch | undefined
): UpstreamPlan {
  const anthropic = createAnthropic({
    apiKey: route.providerApiKey,
    baseURL: normalizeBaseUrl(route.providerBaseUrl),
    headers: extraHeaders,
    fetch: fetchImpl
  })
  const budget = effort ? THINKING_BUDGET[effort] : undefined
  let maxOutputTokens = clientMax ?? DEFAULT_MAX_OUTPUT_TOKENS
  if (budget) {
    // thinking 预算必须小于 max_tokens：不足时抬高输出上限
    maxOutputTokens = Math.max(maxOutputTokens, budget + 1024)
  }
  return {
    model: anthropic(route.upstreamName),
    thinkingBudget: budget,
    reasoningEffort: undefined,
    disableSampling: Boolean(budget),
    maxOutputTokens
  }
}

function planResponses(
  route: MappingRoute,
  effort: ReasoningEffort | undefined,
  clientMax: number | undefined,
  extraHeaders: Record<string, string>,
  fetchImpl: typeof fetch | undefined
): UpstreamPlan {
  const openai = createOpenAI({
    apiKey: route.providerApiKey,
    baseURL: normalizeBaseUrl(route.providerBaseUrl),
    headers: extraHeaders,
    fetch: fetchImpl
  })
  return {
    model: openai.responses(route.upstreamName),
    thinkingBudget: undefined,
    reasoningEffort: effort,
    disableSampling: false,
    maxOutputTokens: clientMax
  }
}
