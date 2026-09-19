import { createEntryHandler } from './entry'

/** POST /v1/chat/completions：OpenAI Chat 入口 */
export const handleChatCompletions = createEntryHandler('openai')
