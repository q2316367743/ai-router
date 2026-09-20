import type { QuotaRateWindow, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

const DATA_URL =
  'https://t3.chat/api/trpc/getCustomerData?batch=1&input=' +
  encodeURIComponent(
    JSON.stringify({
      0: { json: { sessionId: null }, meta: { values: { sessionId: ['undefined'] } } }
    })
  )

/** 深度优先寻找含用量字段的对象：数组同样遍历（JS 的 find 对数组也走 Object.values） */
function findCustomerData(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    'usageFourHourPercentage' in record ||
    'usageMonthPercentage' in record ||
    (record.subscription && record.usageBand)
  ) {
    return record
  }
  for (const child of Object.values(record)) {
    const found = findCustomerData(child)
    if (found) return found
  }
  return null
}

/**
 * T3 Chat：GET /api/trpc/getCustomerData（Cookie）→ 订阅 4 小时 / 月度用量百分比，
 * JSONL 逐行解析定位客户数据（由 CodexBar t3chat.js 1:1 移植）
 */
export const t3chatStrategy: QuotaStrategy = {
  meta: {
    id: 't3chat',
    label: 'T3 Chat',
    builtin: true,
    credential: 'cookie',
    description: '订阅用量；需附加配置粘贴浏览器 Cookie',
    settings: [
      {
        key: 'cookie',
        title: '浏览器 Cookie',
        widget: 'textarea',
        hint: '在浏览器开发者工具复制 t3.chat 请求的 Cookie 头整段粘贴'
      }
    ]
  },
  async fetch(ctx) {
    const cookie = strOf(ctx.config.cookie)
    if (!cookie) throw ctx.fail.missingCredential('请在提供商的附加配置中粘贴 t3.chat 的 Cookie 头')

    const response = await ctx.http.get(DATA_URL, {
      headers: {
        Cookie: cookie,
        Origin: 'https://t3.chat',
        Referer: 'https://t3.chat/settings/customization',
        'trpc-accept': 'application/jsonl',
        'x-trpc-source': 'web-client',
        'x-trpc-batch': 'true'
      }
    })
    if (response.status !== 200) throw new Error(`T3 Chat API error: HTTP ${response.status}`)

    let data: Record<string, unknown> | null = null
    for (const line of (response.bodyText ?? '').split(/\r?\n/)) {
      try {
        data = findCustomerData(JSON.parse(line))
      } catch {
        // 非 JSON 行直接跳过
      }
      if (data) break
    }
    if (!data) throw new Error('T3 Chat response is missing customer data')

    const subscription = recordOf(data.subscription)
    const rawPlan: unknown = (subscription ? subscription.productName : undefined) || data.subTier
    const plan = rawPlan
      ? String(rawPlan)
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      : ''
    const toMillis = (value: unknown): number | null => {
      if (!value || Number(value) <= 0) return null
      return Number(value) > 10000000000
        ? ctx.date.unixMillis(Number(value)).getTime()
        : ctx.date.unixSeconds(Number(value)).getTime()
    }

    const primary: QuotaRateWindow = {
      usedPercent: Math.max(0, Math.min(100, Number(data.usageFourHourPercentage || 0))),
      windowMinutes: 240,
      resetsAt: toMillis(data.usageFourHourNextResetAt || data.usageWindowNextResetAt),
      resetDescription: data.usageBand ? `Base - ${String(data.usageBand).trim()}` : 'Base'
    }
    const secondary: QuotaRateWindow = {
      usedPercent: Math.max(
        0,
        Math.min(100, Number((data.usageMonthPercentage ?? data.usagePeriodPercentage) ?? 0))
      ),
      resetsAt: toMillis(data.subscription && recordOf(data.subscription)?.currentPeriodEnd),
      resetDescription: 'Overage'
    }
    return {
      primary,
      secondary,
      identity: { loginMethod: plan || undefined }
    }
  }
}
