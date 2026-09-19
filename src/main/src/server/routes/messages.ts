import { createEntryHandler } from './entry'

/** POST /v1/messages：Anthropic Messages 入口 */
export const handleMessages = createEntryHandler('anthropic')
