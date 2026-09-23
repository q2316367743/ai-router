/**
 * 渠道亲和：同一会话固定同一提供商。
 *
 * 目的是保住上游的 prompt cache 命中率——同一会话在两家渠道间来回切，等于每次都在冷启动。
 * 标识取值按「客户端显式声明 → 协议元数据 → 消息指纹」三段兜底，最后一段是为了让
 * 不发会话 ID 的客户端（opencode 之类）也能命中亲和。
 *
 * 绑定是**软**的：绑定渠道被额度阻断 / 停用 / 归档时自动弃用改选；改道成功后重新绑定。
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { LRUCache } from 'lru-cache'
import { SESSION_FINGERPRINT_CHARS, SESSION_MAX, SESSION_TTL_MS } from './config'

/** 客户端显式声明的会话标识请求头（Node 已把请求头名归一为小写） */
const SESSION_HEADERS = [
  'x-session-id',
  'x-conversation-id',
  'session-id',
  'x-claude-code-session-id'
] as const

/** 请求体里的会话标识字段（各协议与客户端的既有惯例） */
const SESSION_BODY_KEYS = ['prompt_cache_key', 'session_id', 'conversation_id'] as const

/** 指纹取样条数上限：只看前几条消息，避免在大 body 上做全量遍历 */
const FINGERPRINT_MESSAGE_LIMIT = 8

/** (对外模型名 + 会话标识) → providerId：闲置 2 小时自动过期，活跃访问续期 */
const bindings = new LRUCache<string, string>({
  max: SESSION_MAX,
  ttl: SESSION_TTL_MS,
  updateAgeOnGet: true
})

/**
 * 提取会话标识；三段都拿不到时返回 null（该请求按权重分配，不绑亲和）。
 *
 * 不同来源的值加前缀隔离，避免恰好同名的头值与体字段互相污染。
 */
export function sessionKeyOf(req: IncomingMessage, body: Record<string, unknown>): string | null {
  for (const name of SESSION_HEADERS) {
    const value = headerValue(req.headers[name])
    if (value) return `h:${value}`
  }
  for (const key of SESSION_BODY_KEYS) {
    const value = stringOf(body[key])
    if (value) return `b:${value}`
  }
  // Anthropic 的 metadata.user_id（Claude Code 形如 user_xxx_account_xxx_session_xxx）
  const userId = stringOf(recordOf(body['metadata'])?.['user_id'])
  if (userId) return `m:${sessionSegmentOf(userId)}`
  return fingerprintOf(body)
}

/**
 * 绑定键 = 对外模型名 + 会话标识：同一会话混用多个对外名时各走各的绑定，
 * 否则两条模型会互相把绑定翻来翻去（翻到不属于当前候选的那个就等于没有亲和）。
 */
function bindingKeyOf(sessionKey: string, publicModel: string): string {
  return `${publicModel}\u0000${sessionKey}`
}

/** 上次绑定成功的渠道（未绑定 / 已过期返回 null） */
export function boundProviderOf(sessionKey: string, publicModel: string): string | null {
  return bindings.get(bindingKeyOf(sessionKey, publicModel)) ?? null
}

/** 绑定（改道成功后调用，让会话跟着实际服务的渠道走） */
export function bindSession(sessionKey: string, publicModel: string, providerId: string): void {
  bindings.set(bindingKeyOf(sessionKey, publicModel), providerId)
}

/** 会话键的日志展示形态：指纹是不可逆哈希，直接给出；其余来源可能很长，只留前缀若干位 */
const DISPLAY_VALUE_CHARS = 8

export function displaySessionKey(key: string | null): string {
  if (!key) return '-'
  const at = key.indexOf(':')
  if (at < 0) return key
  const prefix = key.slice(0, at + 1)
  const value = key.slice(at + 1)
  if (prefix === 'fp:') return key
  return `${prefix}${value.slice(0, DISPLAY_VALUE_CHARS)}`
}

/** 清空全部绑定（关闭会话亲和时调用） */
export function clearSessionBindings(): void {
  bindings.clear()
}

/**
 * 消息指纹兜底：`系统提示 + 首条用户消息` 的哈希。
 *
 * 同一会话里这两段是稳定的（后续轮次只是追加消息），不同会话几乎不会撞；
 * 即使撞上也只是两条会话共用渠道，没有副作用。上下文压缩改写首条消息时会重新绑定。
 */
function fingerprintOf(body: Record<string, unknown>): string | null {
  const system = systemTextOf(body)
  const user = firstMessageText(body, ['user'])
  if (!system && !user) return null
  const digest = createHash('sha1')
    .update(`${system ?? ''}\n\n${user ?? ''}`)
    .digest('hex')
  return `fp:${digest.slice(0, 20)}`
}

/** 系统提示：body.system / body.instructions 优先，其次 messages 里的首条 system */
function systemTextOf(body: Record<string, unknown>): string | null {
  for (const key of ['system', 'instructions']) {
    const text = textOf(body[key])
    if (text) return text
  }
  return firstMessageText(body, ['system', 'developer'])
}

/** 按角色取首条消息文本；Responses 的 input 允许是纯字符串数组 */
function firstMessageText(body: Record<string, unknown>, roles: readonly string[]): string | null {
  for (const key of ['messages', 'input']) {
    const list = body[key]
    if (!Array.isArray(list)) continue
    for (const item of list.slice(0, FINGERPRINT_MESSAGE_LIMIT)) {
      if (typeof item === 'string') {
        if (roles.includes('user')) return item
        continue
      }
      if (typeof item !== 'object' || item === null) continue
      const entry = item as Record<string, unknown>
      const role = entry['role']
      if (typeof role !== 'string' || !roles.includes(role)) continue
      const text = textOf(entry['content']) ?? textOf(entry['text'])
      if (text) return text
    }
  }
  return null
}

/** 宽松取文本：字符串 / 内容块数组 / 内容块对象（{text} 或嵌套 {content}）；统一截到指纹取样长度 */
function textOf(value: unknown): string | null {
  if (typeof value === 'string') return sliceText(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item)
      if (text) return text
    }
    return null
  }
  if (typeof value === 'object' && value !== null) {
    const entry = value as Record<string, unknown>
    const direct = entry['text']
    if (typeof direct === 'string' && direct) return sliceText(direct)
    const nested = entry['content']
    if (nested !== undefined) return textOf(nested)
  }
  return null
}

/** 取 user_id 里的 session_xxx 段（取不到就用整串，长度仍受 clip 约束） */
function sessionSegmentOf(userId: string): string {
  const matched = /session_[0-9a-zA-Z-]{6,}/.exec(userId)
  return matched ? matched[0] : userId
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? clipIdentifier(value) : null
}

function headerValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const text = raw?.trim()
  return text ? clipIdentifier(text) : null
}

/** 标识长度收敛：过短（1~3 字符）视为噪声，过长截断（防异常长串占满绑定表） */
function clipIdentifier(value: string): string | null {
  const text = value.trim()
  if (text.length < 4) return null
  return text.length > 200 ? text.slice(0, 200) : text
}

/** 指纹取样片段：只取前缀，大 body 上不做全量哈希 */
function sliceText(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  return text.length > SESSION_FINGERPRINT_CHARS ? text.slice(0, SESSION_FINGERPRINT_CHARS) : text
}
