import type { QuotaStrategy } from '@common/types'
import { aiandStrategy } from './aiand'
import { chutesStrategy } from './chutes'
import { codexStrategy } from './codex'
import { codebuffStrategy } from './codebuff'
import { deepinfraStrategy } from './deepinfra'
import { deepseekStrategy } from './deepseek'
import { elevenlabsStrategy } from './elevenlabs'
import { minimaxStrategy } from './minimax'
import { moonshotStrategy } from './moonshot'
import { opencodeStrategy } from './opencode'
import { litellmStrategy, llmproxyStrategy } from './selfhosted'
import { neuralwattStrategy, zenmuxStrategy } from './zenmux'
import { warpStrategy } from './warp'

/** Swift 原生移植的 TS 内置策略（批次 1：端点与响应结构均已从 CodexBar 确认） */
export const nativeStrategies: QuotaStrategy[] = [
  opencodeStrategy,
  codexStrategy,
  deepseekStrategy,
  moonshotStrategy,
  minimaxStrategy,
  elevenlabsStrategy,
  deepinfraStrategy,
  chutesStrategy,
  codebuffStrategy,
  aiandStrategy,
  llmproxyStrategy,
  litellmStrategy,
  zenmuxStrategy,
  neuralwattStrategy,
  warpStrategy
]
