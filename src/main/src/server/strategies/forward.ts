import type { ProviderProtocol } from '@common/types'
import type { RequestContext } from './types'
import { strategyOf } from './registry'
import { passthrough } from './passthrough'
import { converted } from './converted'

/**
 * 请求转发分发：入口协议 × 上游协议任意组合。
 * 同协议 → raw 透传（body 除 model 外原样、响应原样，未知字段零损失）；
 * 异协议 → 入口解析为统一会话 → 上游构建/解码 → 入口编码回写。
 */
export async function forwardRequest(
  ctx: RequestContext,
  entryProtocol: ProviderProtocol
): Promise<void> {
  const entry = strategyOf(entryProtocol)
  const upstream = strategyOf(ctx.route.providerProtocol)
  if (upstream.protocol === entry.protocol) return passthrough(ctx, upstream)
  return converted(ctx, entry, upstream)
}
