import { useEffect } from 'react'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import type { ImageEditorV3RasterExportFormat } from '@/platform/contracts/imageEditorV3'
import type { ImageMarkToolV3HostController, ImageMarkToolV3HostProps } from './useImageMarkToolV3Host'

/** 文件动作属于图片宿主，复用其保存屏障与导出格式可用性。 */
export function ImageEditorFileAppMenus({ host, onSave, onSaveAs, exportOptions }: {
  host: Pick<ImageMarkToolV3HostController, 'isHostBusy' | 'handleRasterExport'>
  exportOptions: readonly { format: ImageEditorV3RasterExportFormat; label: string; disabledReason?: string }[]
} & Pick<ImageMarkToolV3HostProps, 'onSave' | 'onSaveAs'>): null {
  const visible = useAppMenuVisibility()
  useEffect(() => {
    if (!visible) return
    const busy = host.isHostBusy ? '正在处理图片，请稍候' : undefined
    return contributeAppMenus('imageEdit.file', [{ menu: 'file', order: 100, items: [
      { kind: 'action', id: 'imageEdit.save', label: '保存', disabledReason: busy, run: async () => { await onSave() } },
      { kind: 'action', id: 'imageEdit.saveAs', label: '另存为…', disabledReason: busy, run: async () => { await onSaveAs() } },
      { kind: 'submenu', id: 'imageEdit.export', label: '导出图片', disabledReason: busy, items: exportOptions.map(({ format, label, disabledReason }) => ({
        kind: 'action', id: `imageEdit.export.${format}`, label, disabledReason,
        run: () => host.handleRasterExport(format),
      })) },
    ] }])
  }, [visible, host, onSave, onSaveAs, exportOptions])
  return null
}
