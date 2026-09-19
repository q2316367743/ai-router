import { ref } from 'vue'
import { Button, DrawerPlugin } from 'tdesign-vue-next'
import type { QuotaPluginInfo } from '@common/types'
import PluginContent from './PluginContent.vue'

/** 打开外置策略新增/编辑抽屉（onSaved 保存成功后回调）。保存/取消 footer 置底，
 * 内容组件经 defineExpose({ submit, saving }) 驱动 */
export function openPluginDrawer(plugin: QuotaPluginInfo | null, onSaved: () => void): void {
  const contentRef = ref<InstanceType<typeof PluginContent> | null>(null)
  const dp = DrawerPlugin({
    header: plugin ? '编辑策略' : '新建策略',
    placement: 'right',
    size: '560px',
    destroyOnClose: true,
    body: () => (
      <PluginContent
        ref={contentRef}
        plugin={plugin}
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
