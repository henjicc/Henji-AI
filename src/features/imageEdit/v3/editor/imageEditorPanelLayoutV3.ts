export type ImageEditorPanelIdV3 = 'layers' | 'properties'

export type ImageEditorPanelDockEdgeV3 = 'left' | 'right'

export interface ImageEditorFloatingPanelPositionV3 {
  left: number
  top: number
}

export interface ImageEditorPanelSizeV3 {
  width: number
  height: number
}

export interface ImageEditorPanelViewportV3 {
  width: number
  height: number
}

export const IMAGE_EDITOR_PANEL_GAP_V3 = 8
export const IMAGE_EDITOR_PANEL_DOCK_THRESHOLD_V3 = 48
export const IMAGE_EDITOR_PANEL_DOCK_MIN_WIDTH_V3 = 240
export const IMAGE_EDITOR_PANEL_DOCK_MAX_WIDTH_V3 = 560
export const IMAGE_EDITOR_PANEL_DOCK_MAX_RATIO_V3 = 0.55
export const IMAGE_EDITOR_PANEL_DOCK_MIN_SECTION_HEIGHT_V3 = 112

export function clampImageEditorDockWidthV3(width: number, viewportWidth: number): number {
  const maximum = Math.max(
    IMAGE_EDITOR_PANEL_DOCK_MIN_WIDTH_V3,
    Math.min(IMAGE_EDITOR_PANEL_DOCK_MAX_WIDTH_V3, viewportWidth * IMAGE_EDITOR_PANEL_DOCK_MAX_RATIO_V3),
  )
  return Math.min(maximum, Math.max(IMAGE_EDITOR_PANEL_DOCK_MIN_WIDTH_V3, width))
}

export function resolveImageEditorDockSplitV3(pointerY: number, top: number, height: number): number {
  if (height <= 0) return 0.5
  const minimum = Math.min(0.45, IMAGE_EDITOR_PANEL_DOCK_MIN_SECTION_HEIGHT_V3 / height)
  return Math.max(minimum, Math.min(1 - minimum, (pointerY - top) / height))
}

export function clampImageEditorFloatingPanelPositionV3(
  position: ImageEditorFloatingPanelPositionV3,
  size: ImageEditorPanelSizeV3,
  viewport: ImageEditorPanelViewportV3,
): ImageEditorFloatingPanelPositionV3 {
  return {
    left: Math.min(
      Math.max(IMAGE_EDITOR_PANEL_GAP_V3, viewport.width - size.width - IMAGE_EDITOR_PANEL_GAP_V3),
      Math.max(IMAGE_EDITOR_PANEL_GAP_V3, position.left),
    ),
    top: Math.min(
      Math.max(IMAGE_EDITOR_PANEL_GAP_V3, viewport.height - 32),
      Math.max(IMAGE_EDITOR_PANEL_GAP_V3, position.top),
    ),
  }
}

/** 吸附以面板可见边沿为准，不能用指针位置代替用户眼睛看到的距离。 */
export function resolveImageEditorPanelDockEdgeV3(
  position: ImageEditorFloatingPanelPositionV3,
  size: ImageEditorPanelSizeV3,
  viewport: ImageEditorPanelViewportV3,
): ImageEditorPanelDockEdgeV3 | null {
  const leftGap = position.left
  const rightGap = viewport.width - position.left - size.width
  if (leftGap <= IMAGE_EDITOR_PANEL_DOCK_THRESHOLD_V3 && leftGap <= rightGap) return 'left'
  if (rightGap <= IMAGE_EDITOR_PANEL_DOCK_THRESHOLD_V3) return 'right'
  return null
}

/** 同一边缘已有面板时，按拖放中心落在兄弟面板中心的上方或下方决定组合顺序。 */
export function resolveImageEditorPanelDockIndexV3(
  pointerY: number,
  siblingCenters: readonly number[],
): number {
  const index = siblingCenters.findIndex((center) => pointerY < center)
  return index < 0 ? siblingCenters.length : index
}
