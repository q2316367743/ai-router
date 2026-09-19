/**
 * 内置脚本策略：CodexBar 打包的 20 个 defineProvider 插件原样复用（?raw 导入随构建内联），
 * eval 加载后包装成 QuotaStrategy。label/credential 由此处的目录标注（脚本 manifest 为准校验 id）。
 */
import type { QuotaStrategy, QuotaStrategyContext } from '@common/types'
import { evaluatePlugin, type LoadedPlugin } from '../runtime/evaluate'
import { fetchByPlugin } from '../runtime/context'

import clawrouterSource from '../builtin-plugins/clawrouter.js?raw'
import clinepassSource from '../builtin-plugins/clinepass.js?raw'
import crofSource from '../builtin-plugins/crof.js?raw'
import deepgramSource from '../builtin-plugins/deepgram.js?raw'
import huggingfaceSource from '../builtin-plugins/huggingface.js?raw'
import manusSource from '../builtin-plugins/manus.js?raw'
import museSource from '../builtin-plugins/muse.js?raw'
import nousSource from '../builtin-plugins/nous.js?raw'
import openaiSource from '../builtin-plugins/openai.js?raw'
import openrouterSource from '../builtin-plugins/openrouter.js?raw'
import perplexitySource from '../builtin-plugins/perplexity.js?raw'
import poeSource from '../builtin-plugins/poe.js?raw'
import qoderSource from '../builtin-plugins/qoder.js?raw'
import replicateSource from '../builtin-plugins/replicate.js?raw'
import sub2apiSource from '../builtin-plugins/sub2api.js?raw'
import syntheticSource from '../builtin-plugins/synthetic.js?raw'
import t3chatSource from '../builtin-plugins/t3chat.js?raw'
import veniceSource from '../builtin-plugins/venice.js?raw'
import xaiSource from '../builtin-plugins/xai.js?raw'
import zaiSource from '../builtin-plugins/zai.js?raw'

type Credential = QuotaStrategy['meta']['credential']

interface ScriptedEntry {
  id: string
  source: string
  label: string
  credential: Credential
  description: string
  /** 执行前的附加配置增强（如 zai 按.baseUrl 推断区域） */
  enhance?: (ctx: QuotaStrategyContext) => Record<string, string>
}

const ENTRIES: ScriptedEntry[] = [
  { id: 'zai', source: zaiSource, label: 'Z.ai / GLM', credential: 'apiKey', description: 'GLM Coding Plan：5 小时 / 每周 / 月度 MCP 限额；区域按 Base URL 自动推断', enhance: (ctx) => ({ ...ctx.config, Z_AI_REGION: ctx.config.Z_AI_REGION || (/bigmodel\.cn/i.test(ctx.baseUrl) ? 'bigmodel-cn' : 'global') }) },
  { id: 'openai', source: openaiSource, label: 'OpenAI Platform', credential: 'apiKey', description: 'OpenAI 平台：费用用量与 API 余额（区别于 Codex 订阅限额）' },
  { id: 'openrouter', source: openrouterSource, label: 'OpenRouter', credential: 'apiKey', description: '额度与用量（API Key）' },
  { id: 'poe', source: poeSource, label: 'Poe', credential: 'apiKey', description: '点数余额与用量历史（API Key）' },
  { id: 'venice', source: veniceSource, label: 'Venice', credential: 'apiKey', description: '账户余额（API Key）' },
  { id: 'synthetic', source: syntheticSource, label: 'Synthetic', credential: 'apiKey', description: '配额查询（API Key）' },
  { id: 'xai', source: xaiSource, label: 'xAI', credential: 'apiKey', description: '团队账单余额（Management API Key）' },
  { id: 'clawrouter', source: clawrouterSource, label: 'ClawRouter', credential: 'apiKey', description: '额度查询（API Key）' },
  { id: 'clinepass', source: clinepassSource, label: 'Cline Pass', credential: 'apiKey', description: '订阅用量（API Key）' },
  { id: 'crof', source: crofSource, label: 'Crof', credential: 'apiKey', description: '额度查询（API Key）' },
  { id: 'deepgram', source: deepgramSource, label: 'Deepgram', credential: 'apiKey', description: '余额与用量（API Key）' },
  { id: 'nous', source: nousSource, label: 'Nous Portal', credential: 'token', description: 'Portal 用量；附加配置 portalUrl 可自定义服务地址' },
  { id: 'sub2api', source: sub2apiSource, label: 'Sub2API', credential: 'apiKey', description: '自建中转用量；Base URL 取提供商地址' },
  { id: 'huggingface', source: huggingfaceSource, label: 'HuggingFace', credential: 'token', description: 'PRO/Enterprise 用量（访问令牌）' },
  { id: 'qoder', source: qoderSource, label: 'Qoder', credential: 'cookie', description: '积分用量；需附加配置粘贴浏览器 Cookie（qoder.com）' },
  { id: 't3chat', source: t3chatSource, label: 'T3 Chat', credential: 'cookie', description: '订阅用量；需附加配置粘贴浏览器 Cookie' },
  { id: 'perplexity', source: perplexitySource, label: 'Perplexity', credential: 'cookie', description: '余额查询；需附加配置粘贴浏览器 Cookie' },
  { id: 'manus', source: manusSource, label: 'Manus', credential: 'cookie', description: '积分余额；需附加配置粘贴浏览器 Cookie' },
  { id: 'muse', source: museSource, label: 'Muse', credential: 'apiKey', description: '订阅用量' },
  { id: 'replicate', source: replicateSource, label: 'Replicate', credential: 'cookie', description: '用量查询；需附加配置粘贴浏览器 Cookie' }
]

/** 加载全部脚本策略：单家失败只记日志跳过，不阻断启动 */
export function loadScriptedStrategies(): { strategies: QuotaStrategy[]; failures: string[] } {
  const strategies: QuotaStrategy[] = []
  const failures: string[] = []
  for (const entry of ENTRIES) {
    try {
      const loaded: LoadedPlugin = evaluatePlugin(entry.source)
      if (loaded.manifest.id !== entry.id) {
        throw new Error(`manifest.id(${loaded.manifest.id}) 与目录标注(${entry.id})不一致`)
      }
      strategies.push({
        meta: {
          id: entry.id,
          label: entry.label,
          builtin: true,
          credential: entry.credential,
          description: entry.description
        },
        fetch: (ctx) =>
          fetchByPlugin(loaded, {
            apiKey: ctx.apiKey,
            baseUrl: ctx.baseUrl,
            config: entry.enhance ? entry.enhance(ctx) : ctx.config
          })
      })
    } catch (err) {
      failures.push(`${entry.label}：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { strategies, failures }
}
