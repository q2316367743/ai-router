import { sendOpenAiError } from '../../respond'
import type { MappingRoute } from '$/db/repo/modelRepo'
import type { ProtocolStrategy } from '../types'
import { parseOpenAiChatRequest } from './parse'
import { createOpenAiEntryEncoder, encodeOpenAiCompletion } from './encode'
import { buildOpenAiChatRequest, OPENAI_CHAT_PATH } from './request'
import { createOpenAiChatDecoder, decodeOpenAiChatResponse } from './decode'

/** OpenAI Chat 协议策略：既作对外入口（/v1/chat/completions），也作上游接口 */
export const openaiChatStrategy: ProtocolStrategy = {
  protocol: 'openai',
  parseRequest: parseOpenAiChatRequest,
  encodeCompletion: encodeOpenAiCompletion,
  createEntryEncoder: createOpenAiEntryEncoder,
  writeError: (res, status, message, code) => sendOpenAiError(res, status, message, code),
  buildRequest: buildOpenAiChatRequest,
  decodeResponse: decodeOpenAiChatResponse,
  createUpstreamDecoder: createOpenAiChatDecoder,
  upstreamPath: OPENAI_CHAT_PATH,
  upstreamAuthHeaders: (route: MappingRoute) => ({
    authorization: `Bearer ${route.providerApiKey}`
  })
}
