import type { ProviderProtocol } from '@common/types'
import type { ProtocolStrategy } from './types'
import { openaiChatStrategy } from './openaiChat'
import { anthropicMessagesStrategy } from './anthropicMessages'
import { openaiResponsesStrategy } from './openaiResponses'

/** providerProtocol → 策略实例（唯一分发点：新增协议在此注册） */
const registry: Record<ProviderProtocol, ProtocolStrategy> = {
  openai: openaiChatStrategy,
  anthropic: anthropicMessagesStrategy,
  'openai-responses': openaiResponsesStrategy
}

export function strategyOf(protocol: ProviderProtocol): ProtocolStrategy {
  return registry[protocol]
}
