import { ref } from 'vue'
import { Button, DrawerPlugin } from 'tdesign-vue-next'
import type { ProviderInfo } from '@common/types'
import ProviderContent from './ProviderContent.vue'

/** 打开提供商新增/编辑抽屉（onSaved 在保存成功后回调，用于刷新列表）。
 * 保存/取消放在外壳 footer 置底（不随内容滚动），内容组件经 defineExpose({ submit, saving }) 供 footer 驱动 */
export function openProviderDrawer(provider: ProviderInfo | null, onSaved: () => void): void {
  const contentRef = ref<InstanceType<typeof ProviderContent> | null>(null)
  const dp = DrawerPlugin({
    header: provider ? '编辑提供商' : '新增提供商',
    placement: 'right',
    size: '560px',
    destroyOnClose: true,
    body: () => (
      <ProviderContent
        ref={contentRef}
        provider={provider}
        onSuccess={() => {
          onSaved()
          dp?.destroy?.()
        }}
      />
    ),
    footer: () => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <Button
          variant="outline"
          disabled={contentRef.value?.saving ?? false}
          onClick={() => dp?.destroy?.()}
        >
          取消
        </Button>
        <Button
          theme="primary"
          loading={contentRef.value?.saving ?? false}
          onClick={() => contentRef.value?.submit()}
        >
          保存
        </Button>
      </div>
    )
  })
}
