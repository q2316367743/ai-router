import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import type { ProviderInfo } from '@common/types'
import ProviderContent from './ProviderContent.vue'

/** 打开提供商新增/编辑弹窗（onSaved 在保存成功后回调，用于刷新列表） */
export function openProviderDialog(provider: ProviderInfo | null, onSaved: () => void): void {
  const dp = DialogPlugin({
    header: provider ? '编辑提供商' : '新增提供商',
    placement: 'center',
    width: '480px',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(ProviderContent, {
        provider,
        onClose: () => dp?.destroy?.(),
        onSuccess: () => {
          onSaved()
          dp?.destroy?.()
        }
      })
  })
}
