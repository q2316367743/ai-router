import type { MappingRoute } from '$/db/repo/modelRepo'
import type { ProtocolStrategy } from '../types'
import { OPENAI_RESPONSES_PATH, buildOpenAiResponsesRequest } from './request'
import { createOpenAiResponsesDecoder, decodeOpenAiResponsesResponse } from './decode'
import {
  createResponsesEntryEncoder,
  encodeResponsesCompletion,
  writeResponsesError
} from './encode'
import { parseOpenAiResponsesRequest } from './parse'

/** OpenAI Responses 协议策略：既作对外入口（/v1/responses），也作上游接口 */
export const openaiResponsesStrategy: ProtocolStrategy = {
  protocol: 'openai-responses',
  parseRequest: parseOpenAiResponsesRequest,
  encodeCompletion: encodeResponsesCompletion,
  createEntryEncoder: createResponsesEntryEncoder,
  writeError: writeResponsesError,
  buildRequest: buildOpenAiResponsesRequest,
  decodeResponse: decodeOpenAiResponsesResponse,
  createUpstreamDecoder: createOpenAiResponsesDecoder,
  upstreamPath: OPENAI_RESPONSES_PATH,
  upstreamAuthHeaders: (route: MappingRoute) => ({
    authorization: `Bearer ${route.providerApiKey}`
  })
}
