type FloatingPanelPlacement = 'above' | 'below'

/** 同时供面板和提示框使用；尺寸超过边界时由调用方限制尺寸。 */
export function clampFloatingAxis(position: number, size: number, start: number, end: number): number {
  return Math.min(Math.max(start, position), Math.max(start, end - size))
}

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
  /** left：左缘对齐锚点；center：居中；right：右缘对齐锚点（卡片上的“更多”按钮菜单）。 */
  horizontalAlign: 'left' | 'center' | 'right'
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

/** 浮层朝触发器错开的距离：进场从这里滑回原位，退场滑回这里。 */
const POPOVER_SHIFT_PX = 4

/**
 * 浮层进出场的缩放中心与错开方向：中心落在触发器中线与浮层贴着触发器的那条边上，浮层像是从按钮里长出来；
 * 在上方展开时从下往上，在下方展开时从上往下。配合 `animate-scale-in` / `animate-scale-out`。
 */
export function resolvePopoverMotionStyle(anchor: Pick<FloatingPanelAnchorRect, 'left' | 'width'>, panelLeft: number, panelWidth: number, placement: FloatingPanelPlacement): Record<string, string> {
  const originX = Math.min(Math.max(anchor.left + anchor.width / 2 - panelLeft, 0), Math.max(0, panelWidth))
  return {
    transformOrigin: `${Math.round(originX)}px ${placement === 'above' ? '100%' : '0%'}`,
    '--ui-pop-shift': `${placement === 'above' ? POPOVER_SHIFT_PX : -POPOVER_SHIFT_PX}px`,
  }
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
  const preferredLeft = horizontalAlign === 'center'
    ? centeredLeft
    : horizontalAlign === 'right'
      ? anchor.left + anchor.width - width
      : anchor.left
  const left = clampFloatingAxis(preferredLeft, width, viewportLeft, viewportRight)
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
