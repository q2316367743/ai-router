import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { QuotaRateWindow, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, recordOf, strOf } from '../util'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** 读取 Codex CLI 登录态（~/.codex/auth.json 的 tokens.access_token），失败返回 null */
function readCodexCliToken(): string | null {
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf-8')) as unknown
    const tokens = recordOf(recordOf(auth)?.tokens)
    return strOf(tokens?.access_token)
  } catch {
    return null
  }
}

function windowOf(record: Record<string, unknown> | null): QuotaRateWindow | null {
  if (!record) return null
  const usedPercent = numOf(record.used_percent)
  if (usedPercent === null) return null
  const resetAt = numOf(record.reset_at)
  const limitSeconds = numOf(record.limit_window_seconds)
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes: limitSeconds && limitSeconds > 0 ? Math.round(limitSeconds / 60) : null,
    resetsAt: resetAt && resetAt > 0 ? resetAt * 1000 : null
  }
}

/**
 * OpenAI Codex（ChatGPT 订阅）：GET chatgpt.com/backend-api/wham/usage → 5 小时 / 每周限额。
 * 凭证：附加配置 token 优先，其次提供商 API Key，最后自动读 Codex CLI 登录态。
 */
export const codexStrategy: QuotaStrategy = {
  meta: {
    id: 'codex',
    label: 'OpenAI Codex',
    builtin: true,
    credential: 'token',
    description: 'ChatGPT/Codex 订阅：5 小时 / 每周限额；令牌来自 Codex CLI 登录（~/.codex/auth.json）或附加配置 token'
  },
  async fetch(ctx) {
    const token = strOf(ctx.config.token) ?? (ctx.apiKey.trim() ? ctx.apiKey.trim() : null) ?? readCodexCliToken()
    if (!token) throw ctx.fail.missingCredential('未找到 Codex 访问令牌：请运行 codex login 或在附加配置填写 token')

    const accountId = strOf(ctx.config.accountId)
    const res = await ctx.http.getJSON(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}) }
    })
    if (res.status === 401 || res.status === 403) {
      throw ctx.fail.authenticationExpired('Codex 令牌已过期：请重新 codex login 或更新附加配置 token')
    }
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const rateLimit = recordOf(body?.rate_limit)
    const primary = windowOf(recordOf(rateLimit?.primary_window))
    if (!primary) throw ctx.fail.parseFailure('响应缺少 rate_limit.primary_window')

    const snapshot: QuotaSnapshot = {
      primary,
      secondary: windowOf(recordOf(rateLimit?.secondary_window))
    }
    const planType = strOf(body?.plan_type)
    if (planType) snapshot.identity = { loginMethod: `Codex ${planType}` }
    return snapshot
  }
}
