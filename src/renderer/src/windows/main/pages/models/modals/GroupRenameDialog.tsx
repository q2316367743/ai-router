import { DialogPlugin } from 'tdesign-vue-next'
import GroupRenameContent from './GroupRenameContent.vue'

/** 打开对外模型重命名弹窗（名字属于整组，改名是一次批量动作） */
export function openGroupRenameDialog(from: string, onSaved: () => void): void {
  const dp = DialogPlugin({
    header: '重命名对外模型',
    placement: 'center',
    width: '480px',
    footer: false,
    destroyOnClose: true,
    body: () => (
      <GroupRenameContent
        from={from}
        onClose={() => dp?.destroy?.()}
        onSuccess={() => {
          onSaved()
          dp?.destroy?.()
        }}
      />
    )
  })
}
