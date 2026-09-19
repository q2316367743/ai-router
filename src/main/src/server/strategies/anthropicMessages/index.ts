import type { MappingRoute } from '$/db/repo/modelRepo'
import type { ProtocolStrategy } from '../types'
import {
  ANTHROPIC_MESSAGES_PATH,
  ANTHROPIC_VERSION,
  buildAnthropicMessagesRequest
} from './request'
import { createAnthropicDecoder, decodeAnthropicResponse } from './decode'
import {
  createAnthropicEntryEncoder,
  encodeAnthropicCompletion,
  writeAnthropicError
} from './encode'
import { parseAnthropicMessagesRequest } from './parse'

/** Anthropic Messages 协议策略：既作对外入口（/v1/messages），也作上游接口 */
export const anthropicMessagesStrategy: ProtocolStrategy = {
  protocol: 'anthropic',
  parseRequest: parseAnthropicMessagesRequest,
  encodeCompletion: encodeAnthropicCompletion,
  createEntryEncoder: createAnthropicEntryEncoder,
  writeError: writeAnthropicError,
  buildRequest: buildAnthropicMessagesRequest,
  decodeResponse: decodeAnthropicResponse,
  createUpstreamDecoder: createAnthropicDecoder,
  upstreamPath: ANTHROPIC_MESSAGES_PATH,
  upstreamAuthHeaders: (route: MappingRoute) => ({
    'x-api-key': route.providerApiKey,
    'anthropic-version': ANTHROPIC_VERSION
  })
}
