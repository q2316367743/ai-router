import { DialogPlugin } from 'tdesign-vue-next'
import type { ModelMappingInfo } from '@common/types'
import ModelContent from './ModelContent.vue'

/**
 * 打开渠道弹窗（onSaved 在保存成功后回调，用于刷新列表）。
 *
 * 三种入口共用：编辑既有渠道 / 往指定对外模型下加渠道（presetName）/ 新建对外模型。
 * 用 JSX 而非 render 函数，与 ProviderDrawer 同风格。
 */
export function openModelDialog(options: {
  mapping: ModelMappingInfo | null
  presetName?: string | null
  channels: ModelMappingInfo[]
  onSaved: () => void
}): void {
  const { mapping, presetName, channels, onSaved } = options
  const addingToGroup = !mapping && !!presetName
  const dp = DialogPlugin({
    header: mapping ? '编辑渠道' : addingToGroup ? '新增渠道' : '新增对外模型',
    placement: 'center',
    width: '520px',
    footer: false,
    destroyOnClose: true,
    body: () => (
      <ModelContent
        mapping={mapping}
        presetName={presetName ?? null}
        channels={channels}
        onClose={() => dp?.destroy?.()}
        onSuccess={() => {
          onSaved()
          dp?.destroy?.()
        }}
      />
    )
  })
}
