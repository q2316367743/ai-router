/** 保留一位小数并去掉结尾 .0：1.0 -> 1、1.5 -> 1.5 */
function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

/** 四舍五入到一位小数（tokenParts 用数值形态，避免下游再格式化一次） */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * token 数拆成「数值 + 单位」两段：940 / {1.2, K} / {3.4, M}（K=千 M=百万 E=亿）。
 * 供 t-statistic 这类需要把数值与单位分成大小两级字号的场景使用；
 * 只要能拼成字符串就用 formatTokens，两者共用同一套分档阈值。
 */
export function tokenParts(n: number): { value: number; unit: string } {
  if (n < 1e3) return { value: n, unit: '' }
  if (n < 1e6) return { value: round1(n / 1e3), unit: 'K' }
  if (n < 1e8) return { value: round1(n / 1e6), unit: 'M' }
  return { value: round1(n / 1e8), unit: 'E' }
}

/** token 数简写：940 / 1.2K / 3.4M / 1.5E（K=千 M=百万 E=亿） */
export function formatTokens(n: number): string {
  const { value, unit } = tokenParts(n)
  return unit ? `${trimZero(value)}${unit}` : String(value)
}
