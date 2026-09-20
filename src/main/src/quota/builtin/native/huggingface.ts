// HuggingFace：PRO/Enterprise 推理与 ZeroGPU 用量查询（由 CodexBar huggingface.js 1:1 移植）
import type { QuotaDetailRow, QuotaDetailSection, QuotaRateWindow, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

interface WhoamiIdentity {
  fetchedAt: number
  username?: string
  email?: string
  plan?: string
}

/** whoami-v2 身份缓存：与脚本宿主 ctx.cache 同为进程级 Map（TTL 43200 秒，值存对象本体） */
const identityCache = new Map<string, { value: WhoamiIdentity; expireAt: number }>()

/**
 * HuggingFace（credential: token）：usage-v2 账单 + ZeroGPU 配额 + whoami-v2 身份，
 * 后两者为可选信息（失败静默降级）。认证 Bearer：附加配置 HF_TOKEN > 提供商 API Key
 * （脚本路径由宿主对所有请求附加 Bearer 头，值为空时宿主不附加，这里保持一致）。
 */
export const huggingfaceStrategy: QuotaStrategy = {
  meta: {
    id: 'huggingface',
    label: 'HuggingFace',
    builtin: true,
    credential: 'token',
    description: 'PRO/Enterprise 用量（访问令牌）',
    settings: [{ key: 'HF_TOKEN', title: '访问令牌', type: 'secure', hint: '可选；缺省使用提供商 API Key' }]
  },
  async fetch(ctx) {
    const token = strOf(ctx.config.HF_TOKEN) ?? (ctx.apiKey.trim() ? ctx.apiKey.trim() : null)
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

    const fail = (field: string): never => {
      throw ctx.fail.parseFailure(`Hugging Face billing response format changed: ${field}`)
    }
    const object = (value: unknown, field: string): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field)
      return recordOf(value) ?? fail(field)
    }
    const number = (value: unknown, field: string): number => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail(field)
      return value
    }
    const optionalNumber = (value: unknown, field: string): number | undefined =>
      value === undefined || value === null ? undefined : number(value, field)
    const parse = (body: unknown): Record<string, unknown> => {
      let value: unknown
      try {
        value = JSON.parse(String(body))
      } catch {
        return fail('invalid JSON')
      }
      return object(value, 'expected an object')
    }
    // 重置时刻统一 epoch 毫秒：脚本 ctx.date.unixSeconds(x) ≡ x*1000，iso(x) 取 getTime()
    const date = (value: unknown): number | undefined => {
      if (value === undefined || value === null) return undefined
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0 || value > 64092211200) return undefined
        return value * 1000
      }
      if (typeof value === 'string') {
        try {
          return ctx.date.iso(value).getTime()
        } catch {
          // 非法日期字符串回落 undefined，与脚本一致
        }
      }
      return undefined
    }
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' ? value.trim() || undefined : undefined

    const now = ctx.date.now()
    const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000)
    const end = Math.floor(now.getTime() / 1000)
    const response = await ctx.http.get(
      `https://huggingface.co/api/settings/billing/usage-v2?startDate=${start}&endDate=${end}`,
      { timeoutSeconds: 15, headers: { 'User-Agent': 'CodexBar', ...authHeaders } }
    )
    if (response.status === 401) {
      throw ctx.fail.authenticationExpired('Hugging Face rejected the token. Check that it is valid and not expired.')
    }
    if (response.status === 403) {
      throw ctx.fail.permissionDenied(
        'The Hugging Face token lacks billing access. Use a classic read token or enable Billing read on a fine-grained token.'
      )
    }
    if (response.status === 429) throw ctx.fail.rateLimited('Hugging Face rate limit reached. Retry later.')
    if (response.status >= 500) {
      throw ctx.fail.providerUnavailable(`Hugging Face API returned HTTP ${response.status}.`)
    }
    if (response.status < 200 || response.status >= 300) {
      throw ctx.fail.apiFailure(`Hugging Face API returned HTTP ${response.status}.`)
    }
    const usage = object(parse(response.bodyText).usage, 'missing usage')
    const inference = object(usage.inferenceProviders, 'missing inferenceProviders usage')
    const gross = number(inference.usedNanoUsd, 'usedNanoUsd') / 1e9
    const included = number(inference.includedNanoUsd, 'includedNanoUsd') / 1e9
    const billable = Math.max(0, gross - included)
    const limit = (optionalNumber(inference.limitNanoUsd, 'limitNanoUsd') ?? 0) / 1e9
    const requests = optionalNumber(inference.numRequests, 'numRequests')
    if (requests !== undefined && !Number.isSafeInteger(requests)) return fail('numRequests')
    let secondary: QuotaRateWindow | null = null
    let gpuRows: QuotaDetailRow[] = []
    try {
      const gpuResponse = await ctx.http.get('https://huggingface.co/api/spaces/zero-gpu/quota', {
        timeoutSeconds: 2,
        headers: authHeaders
      })
      if (gpuResponse.status >= 200 && gpuResponse.status < 300) {
        const gpu = parse(gpuResponse.bodyText)
        const total = number(gpu.base, 'ZeroGPU base')
        const remaining = number(gpu.current, 'ZeroGPU current')
        if (total > 0) {
          const consumed = Math.max(0, total - remaining)
          secondary = {
            usedPercent: ctx.pct(consumed, total),
            resetsAt: date(gpu.resetsAt),
            resetDescription: 'ZeroGPU quota'
          }
          const minutes = (seconds: number): string =>
            `${ctx.format.number(seconds / 60, {
              minimumFractionDigits: seconds >= 600 ? 0 : 1,
              maximumFractionDigits: seconds >= 600 ? 0 : 1
            })} min`
          gpuRows = [
            { label: 'GPU time used', value: minutes(consumed) },
            { label: 'GPU time remaining', value: minutes(remaining) }
          ]
        }
      }
    } catch {
      // 与脚本一致：ZeroGPU 查询失败不影响主流程
    }
    const cacheKey = `whoami-v2:${token}`
    const hit = identityCache.get(cacheKey)
    let identity: WhoamiIdentity | undefined
    if (hit) {
      if (hit.expireAt < Date.now()) identityCache.delete(cacheKey)
      else identity = hit.value
    }
    if (!identity || now.getTime() - identity.fetchedAt < 0 || now.getTime() - identity.fetchedAt >= 43200000) {
      identity = undefined
      try {
        const whoami = await ctx.http.get('https://huggingface.co/api/whoami-v2', {
          timeoutSeconds: 2,
          headers: authHeaders
        })
        if (whoami.status >= 200 && whoami.status < 300) {
          const profile = parse(whoami.bodyText)
          const username = text(profile.name)
          const email = text(profile.email)
          if (username || email) {
            identity = {
              fetchedAt: now.getTime(),
              username,
              email,
              plan: typeof profile.isPro === 'boolean' ? (profile.isPro ? 'PRO' : 'Free') : undefined
            }
            identityCache.set(cacheKey, { value: identity, expireAt: Date.now() + 43200 * 1000 })
          }
        }
      } catch {
        // 与脚本一致：whoami 失败不影响主流程
      }
    }
    // usage-v2 报告的是查询区间，其截止时刻并非配额重置；账单口径为 usedNanoUsd − includedNanoUsd
    const rows: QuotaDetailRow[] = [{ label: 'Billable usage', value: ctx.format.usd(billable) }]
    if (included > 0) {
      rows.push({ label: 'Gross inference usage', value: ctx.format.usd(gross) })
      rows.push({ label: 'Included inference amount', value: ctx.format.usd(included) })
    }
    if (limit > 0) rows.push({ label: 'Spending limit', value: ctx.format.usd(limit) })
    if (requests !== undefined) rows.push({ label: 'Requests', value: String(requests) })
    const details: QuotaDetailSection[] = [{ title: 'Inference Providers', rows }]
    if (gpuRows.length) details.push({ title: 'ZeroGPU', rows: gpuRows })
    return {
      secondary,
      cost: { used: billable, limit: limit > 0 ? limit : undefined, currency: 'USD', period: 'This month' },
      details,
      identity: identity
        ? { email: identity.email, accountID: identity.username, loginMethod: identity.plan }
        : undefined
    }
  }
}
