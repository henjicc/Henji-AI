export type FloatingPanelPlacement = 'above' | 'below'

export interface FloatingPanelAnchorRect {
  top: number
  bottom: number
  left: number
  width: number
}

interface ResolveFloatingPanelPositionOptions {
  anchor: FloatingPanelAnchorRect
  panelWidth: number
  panelHeight: number
  viewportWidth: number
  viewportHeight: number
  preferredPlacement: FloatingPanelPlacement
  horizontalAlign: 'left' | 'center'
  gap: number
  viewportGutter?: number
  viewportTopInset?: number
  boundary?: { left: number; top: number; width: number; height: number }
}

export interface FloatingPanelPosition {
  placement: FloatingPanelPlacement
  top: number
  /** 向上展开时用底边锚定，内容高度变化不能改变与触发器的间距。 */
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

/**
 * 为 portal 浮层选择完整可见的一侧，并将尺寸限制在可用视口内。
 * 桌面端顶部有固定标题栏，因此顶部安全区可以大于普通 viewport gutter。
 */
export function resolveFloatingPanelPosition({
  anchor,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  preferredPlacement,
  horizontalAlign,
  gap,
  viewportGutter = 8,
  viewportTopInset = viewportGutter,
  boundary,
}: ResolveFloatingPanelPositionOptions): FloatingPanelPosition {
  const viewportLeft = Math.max(0, boundary?.left ?? 0) + viewportGutter
  const viewportRight = Math.min(viewportWidth, boundary ? boundary.left + boundary.width : viewportWidth) - viewportGutter
  const viewportTop = Math.max(viewportGutter, viewportTopInset, (boundary?.top ?? 0) + viewportGutter)
  const viewportBottom = Math.max(viewportTop, Math.min(viewportHeight, boundary ? boundary.top + boundary.height : viewportHeight) - viewportGutter)
  const width = Math.min(Math.max(0, panelWidth), Math.max(0, viewportRight - viewportLeft))
  const centeredLeft = anchor.left + anchor.width / 2 - width / 2
  const preferredLeft = horizontalAlign === 'center' ? centeredLeft : anchor.left
  const maxLeft = Math.max(viewportLeft, viewportRight - width)
  const left = Math.min(Math.max(viewportLeft, preferredLeft), maxLeft)
  const spaceAbove = Math.max(0, anchor.top - gap - viewportTop)
  const spaceBelow = Math.max(0, viewportBottom - anchor.bottom - gap)
  const preferredSpace = preferredPlacement === 'above' ? spaceAbove : spaceBelow
  const alternatePlacement: FloatingPanelPlacement = preferredPlacement === 'above' ? 'below' : 'above'
  const alternateSpace = alternatePlacement === 'above' ? spaceAbove : spaceBelow

  let placement = preferredPlacement
  if (panelHeight > preferredSpace) {
    placement = panelHeight <= alternateSpace || alternateSpace > preferredSpace
      ? alternatePlacement
      : preferredPlacement
  }

  const maxHeight = placement === 'above' ? spaceAbove : spaceBelow
  const visibleHeight = Math.min(Math.max(0, panelHeight), maxHeight)
  const top = placement === 'above'
    ? Math.max(viewportTop, anchor.top - gap - visibleHeight)
    : anchor.bottom + gap

  const bottom = placement === 'above' ? viewportHeight - anchor.top + gap : undefined
  return { placement, top, bottom, left, width, maxHeight }
}
