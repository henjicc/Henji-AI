import { CANVAS_NODE_TYPES, type CanvasNode } from './canvasNodes'

export function resolveOutpaintNodeLayout(aspect: number) {
  const stageWidth = Math.min(502, 382 * aspect)
  const stageHeight = stageWidth / aspect
  return { width: stageWidth + 218, height: stageHeight + 18,
    minWidth: (stageWidth + 218) * 0.75, minHeight: (stageHeight + 18) * 0.75 }
}

/** 只在源图比例首次确定或改变时调整布局，缩放手势完全交给 ReactFlow。 */
export function applyOutpaintSourceLayout(previous: CanvasNode, next: CanvasNode): CanvasNode {
  const ui = next.data.generationUi
  const aspect = next.data.outpaintSourceAspectRatio
  if (next.type !== CANVAS_NODE_TYPES.imageEdit || !ui || typeof ui !== 'object'
    || !('workbenchEditor' in ui) || ui.workbenchEditor !== 'outpaint'
    || typeof aspect !== 'number' || !Number.isFinite(aspect) || aspect <= 0
    || previous.data.outpaintSourceAspectRatio === aspect) return next
  const { width, height } = resolveOutpaintNodeLayout(aspect)
  return { ...next, width, height, measured: { width, height },
    style: { ...next.style, width, height }, data: { ...next.data, isSizeManuallyAdjusted: true } }
}
