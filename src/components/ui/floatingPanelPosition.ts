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
}

export interface FloatingPanelPosition {
  placement: FloatingPanelPlacement
  top: number
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
}: ResolveFloatingPanelPositionOptions): FloatingPanelPosition {
  const viewportTop = Math.max(viewportGutter, viewportTopInset)
  const viewportBottom = Math.max(viewportTop, viewportHeight - viewportGutter)
  const width = Math.min(Math.max(0, panelWidth), Math.max(0, viewportWidth - viewportGutter * 2))
  const centeredLeft = anchor.left + anchor.width / 2 - width / 2
  const preferredLeft = horizontalAlign === 'center' ? centeredLeft : anchor.left
  const maxLeft = Math.max(viewportGutter, viewportWidth - width - viewportGutter)
  const left = Math.min(Math.max(viewportGutter, preferredLeft), maxLeft)
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

  return { placement, top, left, width, maxHeight }
}
