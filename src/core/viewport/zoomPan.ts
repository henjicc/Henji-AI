/**
 * 画面视口的缩放平移数学：图片编辑器与画布里能放大看的画面（局部重绘蒙版、扩图、全景平面）共用一份。
 * 约定：画面以视口中心为原点，先平移 pan（屏幕像素）再缩放 zoom；锚点同样以视口中心为原点。
 */
export interface ViewportPan {
  x: number
  y: number
}

export interface ViewportZoomLimits {
  min: number
  max: number
}

const DEFAULT_LIMITS: ViewportZoomLimits = { min: 0.05, max: 8 }

export function clampViewportZoom(value: number, limits: ViewportZoomLimits = DEFAULT_LIMITS): number {
  if (!Number.isFinite(value)) return Math.min(limits.max, Math.max(limits.min, 1))
  return Math.min(limits.max, Math.max(limits.min, value))
}

export function normalizeViewportPan(value: ViewportPan): ViewportPan {
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
  }
}

/** 保持 point（相对于视口中心）指向同一画面位置，避免缩放时画面跳向中心。 */
export function zoomViewportAroundPoint(
  currentZoom: number,
  currentPan: ViewportPan,
  requestedZoom: number,
  point: ViewportPan,
  limits: ViewportZoomLimits = DEFAULT_LIMITS,
): { zoom: number; pan: ViewportPan } {
  const zoom = clampViewportZoom(requestedZoom, limits)
  const safeCurrentZoom = clampViewportZoom(currentZoom, limits)
  const pan = normalizeViewportPan(currentPan)
  const anchor = normalizeViewportPan(point)
  const ratio = zoom / safeCurrentZoom
  return {
    zoom,
    pan: {
      x: anchor.x - (anchor.x - pan.x) * ratio,
      y: anchor.y - (anchor.y - pan.y) * ratio,
    },
  }
}

export function viewportTransform(zoom: number, pan: ViewportPan, limits: ViewportZoomLimits = DEFAULT_LIMITS): string {
  const normalized = normalizeViewportPan(pan)
  return `translate3d(${normalized.x}px, ${normalized.y}px, 0) scale(${clampViewportZoom(zoom, limits)})`
}

/** 滚轮一格的缩放倍数：向上放大、向下缩小。 */
export function wheelZoomFactor(deltaY: number): number {
  return deltaY < 0 ? 1.15 : 1 / 1.15
}
