import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import type { RequestLogItem } from '@common/types'
import LogDetailContent from './LogDetailContent.vue'

/** 打开单条日志详情弹窗 */
export function openLogDetailDialog(log: RequestLogItem): void {
  const dp = DialogPlugin({
    header: '请求详情',
    placement: 'center',
    width: '560px',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(LogDetailContent, {
        log,
        onClose: () => dp?.destroy?.()
      })
  })
}
