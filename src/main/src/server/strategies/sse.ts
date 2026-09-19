/** 单个上游 SSE 事件（event 字段可能缺省，如 OpenAI 系只有 data 行） */
export interface SseEvent {
  event: string | null
  data: string
}

/**
 * 增量 SSE 解析器：按行聚合，空行派发完整事件，feed/flush 返回新完成的 event 数组。
 * 兼容 `event:` / `data:`（多行 data 按规范以 \n 连接）与 `:` 注释行；半包（chunk 截断行）
 * 由内部缓冲处理，正常流以空行收尾，flush 仅兜底派发残留。
 */
export function createSseParser(): {
  feed(text: string): SseEvent[]
  flush(): SseEvent[]
} {
  let buffer = ''
  let eventName: string | null = null
  let data: string[] = []

  const dispatch = (out: SseEvent[]): void => {
    if (eventName === null && data.length === 0) return
    out.push({ event: eventName, data: data.join('\n') })
    eventName = null
    data = []
  }
  const handleLine = (line: string, out: SseEvent[]): void => {
    if (line === '') {
      dispatch(out)
      return
    }
    if (line.startsWith(':')) return
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      return
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5)
      data.push(value.startsWith(' ') ? value.slice(1) : value)
    }
    // 其余字段（id:/retry:）与本代理无关，忽略
  }
  const drain = (text: string): SseEvent[] => {
    const out: SseEvent[] = []
    buffer += text
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      handleLine(buffer.slice(0, idx).replace(/\r$/, ''), out)
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
    }
    return out
  }
  return {
    feed: drain,
    flush() {
      const out: SseEvent[] = []
      if (buffer) handleLine(buffer.replace(/\r$/, ''), out)
      buffer = ''
      dispatch(out)
      return out
    }
  }
}
