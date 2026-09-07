export interface ToolbarRect {
  left: number
  top: number
  width: number
  height: number
}

export type ToolbarSide = 'above' | 'below'

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/** 以画布可见区域为边界；大节点占满视口时允许覆盖，不能把工具栏挤成零高度。 */
export function resolveNodeToolbarPosition(
  anchor: ToolbarRect,
  toolbar: { width: number; height: number },
  boundary: ToolbarRect,
  previousSide: ToolbarSide = 'above',
  lockSide = false,
): { left: number; top: number; side: ToolbarSide } {
  const gutter = 12
  const gap = 25
  const top = boundary.top + gutter
  const bottom = boundary.top + boundary.height - gutter
  const above = anchor.top - gap - toolbar.height
  const below = anchor.top + anchor.height + gap
  // 回到上方前多留 12px，避免在临界位置来回换位。
  const aboveFits = above >= top + (previousSide === 'below' ? 12 : 0)
  const belowFits = below + toolbar.height <= bottom
  const side = lockSide ? previousSide : aboveFits ? 'above' : belowFits ? 'below' : previousSide
  return {
    left: clamp(anchor.left + (anchor.width - toolbar.width) / 2, boundary.left + gutter, boundary.left + boundary.width - gutter - toolbar.width),
    top: clamp(side === 'above' ? above : below, top, bottom - toolbar.height),
    side,
  }
}
