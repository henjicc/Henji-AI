import { requireVideoEditInstance } from './videoEditService'
import { updateVideoEditSource } from './videoEditSource'
import { isVideoEditSourcePreviewItem } from './videoEditSourcePreview'

/**
 * 素材面板里双击一项（剪辑对齐 PR、达芬奇）：有源文件的与代码画面、图形、文字都在源监视器里预览。
 * 双击不往时间线里放东西，放进时间线只用拖动（2026-10-26 用户要求）。效果（输入滤镜）不是素材项，在效果面板双击施加到选中片段。
 * 序列与素材箱由面板自己处理（打开序列、进入素材箱）。
 */
export async function activateVideoEditProjectItem(projectId: string, itemId: string): Promise<void> {
  const item = requireVideoEditInstance(projectId).document.items.find(value => value.id === itemId)
  if (!item) throw new Error('素材项不存在。')
  if (!item.mediaId && !isVideoEditSourcePreviewItem(requireVideoEditInstance(projectId).document, item.id)) {
    throw new Error(item.kind === 'adjustment' ? '调整图层没有自己的画面：把它拖到时间线上要调整的片段上方。' : '这个素材项没有可预览的画面，请拖到时间线上使用。')
  }
  await updateVideoEditSource(projectId, { itemId: item.id })
}
