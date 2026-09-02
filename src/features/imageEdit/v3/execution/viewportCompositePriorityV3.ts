import { IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'

/** 前台可见草稿永远压过稳定帧；全局分析和整图预取不得占住相机响应。 */
export function resolveImageEditorViewportCompositePriorityV3(
  request: ImageEditorViewportCompositeRequestV3,
): number {
  if (request.phase === 'coarse' && request.coverage === 'viewport') {
    return IMAGE_EDIT_RENDER_PRIORITY.interactionDraft
  }
  if (request.phase === 'target') return IMAGE_EDIT_RENDER_PRIORITY.viewportStable
  if (request.phase === 'analysis') return IMAGE_EDIT_RENDER_PRIORITY.otherVisibleEditor
  if (request.coverage === 'document') return IMAGE_EDIT_RENDER_PRIORITY.prefetch
  return request.quality === 'draft'
    ? IMAGE_EDIT_RENDER_PRIORITY.interactionDraft
    : IMAGE_EDIT_RENDER_PRIORITY.viewportStable
}
