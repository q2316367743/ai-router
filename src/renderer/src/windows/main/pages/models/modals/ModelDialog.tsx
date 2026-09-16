import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import type { ModelMappingInfo } from '@common/types'
import ModelContent from './ModelContent.vue'

/** 打开模型映射新增/编辑弹窗（onSaved 在保存成功后回调，用于刷新列表） */
export function openModelDialog(mapping: ModelMappingInfo | null, onSaved: () => void): void {
  const dp = DialogPlugin({
    header: mapping ? '编辑模型映射' : '新增模型映射',
    placement: 'center',
    width: '480px',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(ModelContent, {
        mapping,
        onClose: () => dp?.destroy?.(),
        onSuccess: () => {
          onSaved()
          dp?.destroy?.()
        }
      })
  })
}
