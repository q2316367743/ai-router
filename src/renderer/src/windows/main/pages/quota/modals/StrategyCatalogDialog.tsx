import { DialogPlugin } from 'tdesign-vue-next'
import StrategyCatalogContent from './StrategyCatalogContent.vue'

/** 打开策略目录弹窗（onChanged 在外置策略增删改后回调，用于刷新余量列表）。
 * 外壳 footer=false：目录为管理列表，操作全部在内容区内 */
export function openStrategyCatalogDialog(onChanged: () => void): void {
  const dp = DialogPlugin({
    header: '余量策略目录',
    placement: 'center',
    width: '760px',
    destroyOnClose: true,
    footer: false,
    body: () => (
      <StrategyCatalogContent
        onChanged={() => onChanged()}
        onClose={() => dp?.destroy?.()}
      />
    )
  })
}
