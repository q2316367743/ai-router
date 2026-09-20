/**
 * strategyConfig JSON 字符串 → 字符串键值对。
 * main 执行侧（quota/service）与渲染层表单回显共用同一口径：非对象 / 解析失败 → 空对象，只保留字符串值。
 */
export function parseQuotaConfig(raw: string | null): Record<string, string> {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}
