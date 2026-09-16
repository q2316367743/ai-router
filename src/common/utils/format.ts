/** 一位小数，去掉结尾 .0：1.0 -> 1、1.5 -> 1.5 */
function unit(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

/** token 数简写：940 / 1.2K / 3.4M / 1.5E（K=千 M=百万 E=亿） */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${unit(n / 1e3)}K`
  if (n < 1e8) return `${unit(n / 1e6)}M`
  return `${unit(n / 1e8)}E`
}
