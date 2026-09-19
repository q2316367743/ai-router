import { MessageUtil } from './modal'

/** 写剪贴板并统一提示结果；空内容不写，直接提示无可复制内容 */
export async function copyText(text: string): Promise<void> {
  if (!text) {
    MessageUtil.error('暂无可复制内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    MessageUtil.success('已复制')
  } catch {
    MessageUtil.error('复制失败')
  }
}
