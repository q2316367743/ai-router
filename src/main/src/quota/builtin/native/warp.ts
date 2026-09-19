import type { QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, recordOf } from '../util'

const API_URL = 'https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo'

const GRAPHQL_QUERY = `query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) {
    __typename
    ... on UserOutput {
      user {
        requestLimitInfo {
          isUnlimited
          nextRefreshTime
          requestLimit
          requestsUsedSinceLastRefresh
        }
      }
    }
  }
}`

/** Warp：POST GraphQL GetRequestLimitInfo（Bearer）→ 请求限额已用/上限与刷新时间 */
export const warpStrategy: QuotaStrategy = {
  meta: {
    id: 'warp',
    label: 'Warp',
    builtin: true,
    credential: 'apiKey',
    description: '请求限额：已用 / 上限与下次刷新时间'
  },
  async fetch(ctx) {
    const res = await ctx.http.postJSON(API_URL, {
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        'x-warp-client-id': 'warp-app',
        'User-Agent': 'Warp/1.0'
      },
      body: {
        query: GRAPHQL_QUERY,
        variables: {
          requestContext: {
            clientContext: {},
            osContext: { category: 'macOS', name: 'macOS', version: '25.6.0' }
          }
        }
      }
    })
    if (res.status === 401) throw ctx.fail.missingCredential('Warp API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const user = recordOf(recordOf(recordOf(res.json)?.data)?.user)
    const info = recordOf(recordOf(user?.user)?.requestLimitInfo)
    const limit = numOf(info?.requestLimit)
    const used = numOf(info?.requestsUsedSinceLastRefresh)
    if (limit === null || used === null) throw ctx.fail.parseFailure('响应缺少 requestLimitInfo')

    const snapshot: QuotaSnapshot = {}
    const isUnlimited = info?.isUnlimited === true
    if (isUnlimited) {
      snapshot.primary = { usedPercent: 0, windowMinutes: null, resetsAt: null, resetDescription: '不限量' }
    } else if (limit > 0) {
      const nextRefresh = numOf(info?.nextRefreshTime)
      snapshot.primary = {
        usedPercent: (used / limit) * 100,
        windowMinutes: null,
        resetsAt: nextRefresh && nextRefresh > 0 ? nextRefresh * 1000 : null,
        resetDescription: '请求限额'
      }
    }
    const secondaryText = `${used}/${limit} 请求`
    snapshot.details = [{ title: '请求限额', rows: [{ label: '本期已用', value: secondaryText }] }]
    return snapshot
  }
}
