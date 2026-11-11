import type { ViewportPan } from '@/core/viewport/zoomPan'

/** 编辑器里一次平移或拖动缩放手势的进行中状态；缩放平移数学在 @/core/viewport/zoomPan。 */
export interface ImageEditorNavigationGestureV3 {
  kind: 'pan' | 'zoom'
  pointerId: number
  startClientX: number
  startClientY: number
  startPan: ViewportPan
  pendingPan: ViewportPan
  startZoom: number
  pendingZoom: number
  anchorPoint: ViewportPan
  moved: boolean
}
