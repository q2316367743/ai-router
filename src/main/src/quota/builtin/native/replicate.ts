import type { QuotaDetailRow, QuotaHttpResponse, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

interface BillingAccount {
  kind: 'user' | 'organization'
  username: string
}

/**
 * Replicate：抓取 /account/billing 页面，从 react-component-props JSON 定位账号，
 * 再查 /invoices 与 /unused-credit（Cookie）→ 本月用量与余额（由 CodexBar replicate.js 1:1 移植）
 */
export const replicateStrategy: QuotaStrategy = {
  meta: {
    id: 'replicate',
    label: 'Replicate',
    builtin: true,
    credential: 'cookie',
    description: '用量查询；需附加配置粘贴浏览器 Cookie',
    settings: [
      {
        key: 'cookie',
        title: '浏览器 Cookie',
        widget: 'textarea',
        hint: '在浏览器开发者工具复制 replicate.com 请求的 Cookie 头整段粘贴'
      }
    ]
  },
  async fetch(ctx) {
    // never 返回需用 function 声明，TS 才据此做控制流收窄（箭头常量不识别）
    function fail(field: string): never {
      throw ctx.fail.parseFailure(`Replicate billing response format changed: ${field}`)
    }
    function expired(): never {
      throw ctx.fail.authenticationExpired(
        'Replicate session expired. Sign in again or paste a fresh Cookie header.'
      )
    }
    const parse = (body: string): unknown => {
      try {
        return JSON.parse(body)
      } catch {
        return fail('invalid JSON')
      }
    }
    const money = (value: unknown): number | undefined => {
      if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined
      const amount = Number(value.trim())
      return Number.isFinite(amount) && amount >= 0 ? amount : undefined
    }
    const validate = (response: QuotaHttpResponse<string>): void => {
      if (response.status === 401 || response.status === 403) expired()
      if (response.status === 429) throw ctx.fail.rateLimited('Replicate rate limit reached.')
      if (response.status === 408 || response.status >= 500)
        throw ctx.fail.providerUnavailable('Replicate billing is unavailable.')
      if (response.status < 200 || response.status >= 300)
        throw ctx.fail.apiFailure(`Replicate returned HTTP ${response.status}.`)
    }

    const cookie = strOf(ctx.config.cookie)
    if (!cookie) {
      throw ctx.fail.missingCredential('请在提供商的附加配置中粘贴 replicate.com 的 Cookie 头')
    }

    const response = await ctx.http.get('https://replicate.com/account/billing', {
      headers: { Cookie: cookie, Accept: 'text/html' },
      timeoutSeconds: 8
    })
    validate(response)

    // 在页面 script 标签里 BFS 查找带 username 的账号对象（共享 4000 节点访问上限）
    const html = response.bodyText ?? ''
    let account: BillingAccount | null = null
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
    let match: RegExpExecArray | null = null
    let visited = 0
    while ((match = scripts.exec(html)) && !account && visited < 4000) {
      if (
        !/\bid\s*=\s*(["'])react-component-props[^"']*\1/i.test(match[1]) ||
        !/\btype\s*=\s*(["'])application\/json\1/i.test(match[1])
      ) {
        continue
      }
      let payload: unknown
      try {
        payload = JSON.parse(match[2])
      } catch {
        continue
      }
      const queue: unknown[] = [payload]
      for (let index = 0; index < queue.length && visited < 4000; index++, visited++) {
        const item = queue[index]
        const object = recordOf(item)
        const candidate = recordOf(object?.account)
        if (
          candidate &&
          (candidate.kind === 'user' || candidate.kind === 'organization') &&
          typeof candidate.username === 'string' &&
          candidate.username.trim()
        ) {
          account = { kind: candidate.kind, username: candidate.username.trim() }
          break
        }
        const children: unknown[] = Array.isArray(item)
          ? item
          : object
            ? Object.values(object)
            : []
        for (const child of children) {
          if (queue.length >= 4000) break
          if (child !== null && typeof child === 'object') queue.push(child)
        }
      }
    }
    if (!account) {
      // 这两个标记用于识别 Replicate 未登录时计费页的公开重定向
      const signInTitle = /<title>\s*Sign in\s*\|\s*Replicate\s*<\/title>/i.test(html)
      const githubLogin = /<a\b[^>]*\bhref=["']\/login\/github\/(?:\?[^"']*)?["']/i.test(html)
      if (signInTitle && githubLogin) expired()
      fail('unrecognized billing account props')
    }

    const base = `https://replicate.com/api/${
      account.kind === 'organization' ? 'organizations' : 'users'
    }/${encodeURIComponent(account.username)}`
    const invoicesResponse = await ctx.http.get(`${base}/invoices`, {
      headers: { Cookie: cookie },
      timeoutSeconds: 8
    })
    validate(invoicesResponse)
    const invoicesRaw: unknown = recordOf(parse(invoicesResponse.bodyText ?? ''))?.invoices
    if (!Array.isArray(invoicesRaw)) fail('missing invoices')
    const invoices: unknown[] = invoicesRaw

    const now = ctx.date.now().getTime()
    const current = invoices
      .map((invoice) => recordOf(invoice))
      .find((invoice) => {
        if (!invoice || invoice.type !== 'monthly-usage') return false
        if (invoice.ended_before === null || invoice.ended_before === undefined) return true
        if (typeof invoice.ended_before !== 'string' || !invoice.ended_before.trim()) return false
        const end = Date.parse(invoice.ended_before)
        return Number.isFinite(end) && end > now
      })
    if (!current) fail('no current monthly-usage invoice')
    const used = money(current.total_cost_before_adjustments)
    if (used === undefined) fail('missing or invalid total_cost_before_adjustments')

    let balance: number | undefined
    try {
      const credit = await ctx.http.get(`${base}/unused-credit`, {
        headers: { Cookie: cookie },
        timeoutSeconds: 2
      })
      if (credit.status >= 200 && credit.status < 300) {
        balance = money(recordOf(parse(credit.bodyText ?? ''))?.unused_credit)
      }
    } catch {
      // 未用余额接口尽力而为，失败静默
    }

    const rows: QuotaDetailRow[] = [{ label: 'Spent this month', value: ctx.format.usd(used) }]
    if (balance !== undefined) rows.push({ label: 'Credit balance', value: ctx.format.usd(balance) })
    return {
      cost: { used, balance, currency: 'USD', period: 'This month' },
      details: [{ title: 'Billing', rows }],
      identity: {
        accountID: account.username,
        organization: account.kind === 'organization' ? account.username : undefined
      }
    }
  }
}
