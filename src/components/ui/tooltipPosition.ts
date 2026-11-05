import { clampFloatingAxis } from './floatingPanelPosition'

/** 首选位置；侧向提示放不下时先换侧，再尝试上下方。 */
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'
export type ResolvedTooltipPlacement = TooltipPlacement
export const TOOLTIP_VIEWPORT_GUTTER_PX = 8
const TOOLTIP_GAP_PX = 8

export interface TooltipAnchorRect {
    top: number
    left: number
    right: number
    width: number
    height: number
}

/**
 * 提示框锚定触发器实际看得见的部分：长条触发器（横跨全片的时间线片段）大半被滚动容器裁掉时，
 * 整个盒子的中点可能远在面板之外，提示框就落到别的面板上去了。沿祖先逐轴减去 overflow 裁切，一点都看不见时退回原盒子。
 */
export function visibleTooltipAnchorRect(element: Element, ownerWindow: Window): TooltipAnchorRect {
    const rect = element.getBoundingClientRect()
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom
    for (let node = element.parentElement; node; node = node.parentElement) {
        const style = ownerWindow.getComputedStyle(node)
        const clipX = style.overflowX !== 'visible' && style.overflowX !== ''
        const clipY = style.overflowY !== 'visible' && style.overflowY !== ''
        if (clipX || clipY) {
            const bounds = node.getBoundingClientRect()
            if (clipX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
            if (clipY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
        }
        // 固定定位不受更外层裁切
        if (style.position === 'fixed') break
    }
    if (right <= left || bottom <= top) return rect
    return { top, left, right, width: right - left, height: bottom - top }
}

/** 返回测量后提示框的左上角，不需要 CSS translate；超大内容按整个视口限制尺寸。 */
export function resolveTooltipPosition({ rect, placement, tooltipWidth, tooltipHeight, viewportWidth, viewportHeight, alignment = 'center' }: {
    rect: TooltipAnchorRect
    placement: TooltipPlacement
    tooltipWidth: number
    tooltipHeight: number
    viewportWidth: number
    viewportHeight: number
    alignment?: 'center' | 'start'
}): { placement: ResolvedTooltipPlacement; top: number; left: number; maxWidth: number; maxHeight: number } {
    const gutter = TOOLTIP_VIEWPORT_GUTTER_PX
    const maxWidth = Math.max(0, viewportWidth - gutter * 2)
    const maxHeight = Math.max(0, viewportHeight - gutter * 2)
    const width = Math.min(Math.max(0, tooltipWidth), maxWidth)
    const height = Math.min(Math.max(0, tooltipHeight), maxHeight)
    const space = {
        top: rect.top - TOOLTIP_GAP_PX - gutter,
        bottom: viewportHeight - gutter - rect.top - rect.height - TOOLTIP_GAP_PX,
        left: rect.left - TOOLTIP_GAP_PX - gutter,
        right: viewportWidth - gutter - rect.right - TOOLTIP_GAP_PX,
    }
    let resolved = placement
    if (placement === 'left' || placement === 'right') {
        const opposite = placement === 'left' ? 'right' : 'left'
        if (width > space[placement]) resolved = width <= space[opposite] ? opposite : 'top'
    }
    if (resolved === 'top' || resolved === 'bottom') {
        const opposite = resolved === 'top' ? 'bottom' : 'top'
        if (height > space[resolved] && space[opposite] > space[resolved]) resolved = opposite
    }
    const vertical = resolved === 'top' || resolved === 'bottom'
    const left = vertical
        ? rect.left + (alignment === 'center' ? (rect.width - width) / 2 : TOOLTIP_GAP_PX)
        : resolved === 'left' ? rect.left - TOOLTIP_GAP_PX - width : rect.right + TOOLTIP_GAP_PX
    const top = vertical
        ? resolved === 'top' ? rect.top - TOOLTIP_GAP_PX - height : rect.top + rect.height + TOOLTIP_GAP_PX
        : rect.top + (rect.height - height) / 2
    return {
        placement: resolved,
        top: clampFloatingAxis(top, height, gutter, viewportHeight - gutter),
        left: clampFloatingAxis(left, width, gutter, viewportWidth - gutter),
        maxWidth,
        maxHeight,
    }
}
