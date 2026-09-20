import type { QuotaStrategy } from '@common/types'
import { aiandStrategy } from './aiand'
import { chutesStrategy } from './chutes'
import { clawrouterStrategy } from './clawrouter'
import { clinepassStrategy } from './clinepass'
import { codexStrategy } from './codex'
import { codebuffStrategy } from './codebuff'
import { crofStrategy } from './crof'
import { deepgramStrategy } from './deepgram'
import { deepinfraStrategy } from './deepinfra'
import { deepseekStrategy } from './deepseek'
import { elevenlabsStrategy } from './elevenlabs'
import { huggingfaceStrategy } from './huggingface'
import { manusStrategy } from './manus'
import { minimaxStrategy } from './minimax'
import { moonshotStrategy } from './moonshot'
import { museStrategy } from './muse'
import { nousStrategy } from './nous'
import { openaiStrategy } from './openai'
import { openrouterStrategy } from './openrouter'
import { opencodeStrategy } from './opencode'
import { perplexityStrategy } from './perplexity'
import { poeStrategy } from './poe'
import { qoderStrategy } from './qoder'
import { replicateStrategy } from './replicate'
import { litellmStrategy, llmproxyStrategy } from './selfhosted'
import { sub2apiStrategy } from './sub2api'
import { syntheticStrategy } from './synthetic'
import { t3chatStrategy } from './t3chat'
import { veniceStrategy } from './venice'
import { neuralwattStrategy, zenmuxStrategy } from './zenmux'
import { warpStrategy } from './warp'
import { xaiStrategy } from './xai'
import { zaiStrategy } from './zai'

/**
 * 全量 TS 内置策略（35 家）：批次 1 为 Swift 原生移植（端点与响应结构已从 CodexBar 确认），
 * 脚本移植段为 CodexBar JS 插件 1:1 迁移（2026-09-20 完成全量迁移，builtin-plugins/ 与
 * scripted.ts 已删除；eval 运行时保留服务外置用户插件）。
 */
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
  warpStrategy,
  // 脚本迁移：zai 含区域按 Base URL 推断；openrouter activity 修正 Management Key 认证
  zaiStrategy,
  openaiStrategy,
  openrouterStrategy,
  poeStrategy,
  veniceStrategy,
  syntheticStrategy,
  xaiStrategy,
  clawrouterStrategy,
  clinepassStrategy,
  crofStrategy,
  deepgramStrategy,
  nousStrategy,
  sub2apiStrategy,
  huggingfaceStrategy,
  museStrategy,
  qoderStrategy,
  t3chatStrategy,
  perplexityStrategy,
  manusStrategy,
  replicateStrategy
]
