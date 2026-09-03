export interface ImageEditorViewportPanV3 {
  x: number
  y: number
}

export interface ImageEditorNavigationGestureV3 {
  kind: 'pan' | 'zoom'
  pointerId: number
  startClientX: number
  startClientY: number
  startPan: ImageEditorViewportPanV3
  pendingPan: ImageEditorViewportPanV3
  startZoom: number
  pendingZoom: number
  anchorPoint: ImageEditorViewportPanV3
  moved: boolean
}

export const IMAGE_EDITOR_VIEWPORT_MIN_ZOOM_V3 = 0.05
export const IMAGE_EDITOR_VIEWPORT_MAX_ZOOM_V3 = 8

export function clampImageEditorViewportZoomV3(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(
    IMAGE_EDITOR_VIEWPORT_MAX_ZOOM_V3,
    Math.max(IMAGE_EDITOR_VIEWPORT_MIN_ZOOM_V3, value),
  )
}

export function normalizeImageEditorViewportPanV3(
  value: ImageEditorViewportPanV3,
): ImageEditorViewportPanV3 {
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
  }
}

/** 保持 point（相对于视口中心）指向同一文档位置，避免缩放时画面跳向中心。 */
export function zoomImageEditorViewportAroundPointV3(
  currentZoom: number,
  currentPan: ImageEditorViewportPanV3,
  requestedZoom: number,
  point: ImageEditorViewportPanV3,
): { zoom: number; pan: ImageEditorViewportPanV3 } {
  const zoom = clampImageEditorViewportZoomV3(requestedZoom)
  const safeCurrentZoom = clampImageEditorViewportZoomV3(currentZoom)
  const pan = normalizeImageEditorViewportPanV3(currentPan)
  const anchor = normalizeImageEditorViewportPanV3(point)
  const ratio = zoom / safeCurrentZoom
  return {
    zoom,
    pan: {
      x: anchor.x - (anchor.x - pan.x) * ratio,
      y: anchor.y - (anchor.y - pan.y) * ratio,
    },
  }
}

export function imageEditorViewportTransformV3(
  zoom: number,
  pan: ImageEditorViewportPanV3,
): string {
  const normalized = normalizeImageEditorViewportPanV3(pan)
  return `translate3d(${normalized.x}px, ${normalized.y}px, 0) scale(${clampImageEditorViewportZoomV3(zoom)})`
}
