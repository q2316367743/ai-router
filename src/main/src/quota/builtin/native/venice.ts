import type { QuotaStrategy } from '@common/types'
import { recordOf } from '../util'

const BALANCE_URL = 'https://api.venice.ai/api/v1/billing/balance'

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  if (!Number.isFinite(number)) throw new Error(`Failed to parse Venice response: ${field} must be numeric`)
  return number
}

/** Venice：GET /api/v1/billing/balance → canConsume 与 USD/DIEM 余额推导用量窗口（由 CodexBar venice.js 1:1 移植） */
export const veniceStrategy: QuotaStrategy = {
  meta: {
    id: 'venice',
    label: 'Venice',
    builtin: true,
    credential: 'apiKey',
    description: '账户余额（API Key）'
  },
  async fetch(ctx) {
    const response = await ctx.http.getJSON(BALANCE_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (response.status !== 200) throw new Error(`Venice API error: HTTP ${response.status}`)

    const payload = recordOf(response.json)
    if (!payload) throw new Error('Failed to parse Venice response: expected an object')
    if (typeof payload.canConsume !== 'boolean') {
      throw new Error('Failed to parse Venice response: canConsume must be a boolean')
    }
    const balances = recordOf(payload.balances)
    if (!balances) throw new Error('Failed to parse Venice response: balances must be an object')

    const consumptionCurrency = payload.consumptionCurrency
    if (consumptionCurrency !== null && consumptionCurrency !== undefined && typeof consumptionCurrency !== 'string') {
      throw new Error('Failed to parse Venice response: consumptionCurrency must be a string')
    }
    const currency = consumptionCurrency ? consumptionCurrency.toUpperCase() : null
    const diem = optionalNumber(balances.diem, 'balances.diem')
    const usd = optionalNumber(balances.usd, 'balances.usd')
    const allocation = optionalNumber(payload.diemEpochAllocation, 'diemEpochAllocation')

    let usedPercent: number
    let resetDescription: string
    if (!payload.canConsume) {
      usedPercent = 100
      resetDescription = 'Balance unavailable for API calls'
    } else if (currency === 'USD' && usd !== null && usd > 0) {
      usedPercent = 0
      resetDescription = `$${usd.toFixed(2)} USD remaining`
    } else if (currency !== 'USD' && diem !== null && allocation !== null && allocation > 0) {
      usedPercent = ctx.pct(allocation - diem, allocation)
      resetDescription = `DIEM ${diem.toFixed(2)} / ${allocation.toFixed(2)} epoch allocation`
    } else if (currency === 'DIEM' && diem !== null && diem > 0) {
      usedPercent = 0
      resetDescription = `DIEM ${diem.toFixed(2)} remaining`
    } else if (diem !== null && diem > 0) {
      usedPercent = 0
      resetDescription = `DIEM ${diem.toFixed(2)} remaining`
    } else if (usd !== null && usd > 0) {
      usedPercent = 0
      resetDescription = `$${usd.toFixed(2)} USD remaining`
    } else {
      usedPercent = 100
      resetDescription = 'No Venice API balance available'
    }

    return {
      primary: { usedPercent, resetDescription },
      identity: {}
    }
  }
}
