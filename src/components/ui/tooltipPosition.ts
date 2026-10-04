/**
 * 提示框相对触发元素的位置（有限枚举）：
 * - `top`（默认）：触发元素正上方、水平居中。
 * - `left`：贴触发元素左侧、垂直居中；左侧放不下依次退到右侧、上方。用于一列紧挨着的表单行
 *   （画布节点参数行的名称），放在上方会盖住上一行（任务 5.4）。
 */
export type TooltipPlacement = 'top' | 'left'
export type ResolvedTooltipPlacement = 'top' | 'left' | 'right'

const TOOLTIP_GAP_PX = 8
const TOOLTIP_VIEWPORT_GUTTER_PX = 8

export const TOOLTIP_PLACEMENT_TRANSFORM_CLASS: Record<ResolvedTooltipPlacement, string> = {
    top: '-translate-x-1/2 -translate-y-full',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2',
}

interface TooltipAnchorRect {
    top: number
    left: number
    right: number
    width: number
    height: number
}

/** 按首选位置与可用宽度决定实际位置与坐标：`left` 放不下退 `right`，再放不下退 `top`。 */
export function resolveTooltipPosition({ rect, placement, tooltipWidth, viewportWidth }: {
    rect: TooltipAnchorRect
    placement: TooltipPlacement
    tooltipWidth: number
    viewportWidth: number
}): { placement: ResolvedTooltipPlacement; top: number; left: number } {
    const middle = rect.top + rect.height / 2
    if (placement === 'left') {
        if (rect.left - TOOLTIP_GAP_PX - tooltipWidth >= TOOLTIP_VIEWPORT_GUTTER_PX) {
            return { placement: 'left', top: middle, left: rect.left - TOOLTIP_GAP_PX }
        }
        if (rect.right + TOOLTIP_GAP_PX + tooltipWidth <= viewportWidth - TOOLTIP_VIEWPORT_GUTTER_PX) {
            return { placement: 'right', top: middle, left: rect.right + TOOLTIP_GAP_PX }
        }
    }
    return { placement: 'top', top: rect.top - TOOLTIP_GAP_PX, left: rect.left + rect.width / 2 }
}
