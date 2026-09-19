import { createEntryHandler } from './entry'

/** POST /v1/responses：OpenAI Responses 入口 */
export const handleResponses = createEntryHandler('openai-responses')
