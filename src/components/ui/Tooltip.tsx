import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'
import { UI_DURATION } from './motion'
import {
    resolveTooltipPosition,
    TOOLTIP_PLACEMENT_TRANSFORM_CLASS,
    type ResolvedTooltipPlacement,
    type TooltipPlacement,
} from './tooltipPosition'

export type { TooltipPlacement } from './tooltipPosition'

type TooltipProps = {
    children: React.ReactElement
    content: React.ReactNode
    /** 悬停多久出现（ms），默认 300（设计稿“提示：悬停 300ms 出现”）。键盘聚焦立即出现。 */
    delay?: number
    className?: string
    contentId?: string
    anchor?: 'trigger-center' | 'pointer-start'
    /** 只对 `trigger-center` 生效，见 `TooltipPlacement`。 */
    placement?: TooltipPlacement
}

export default function Tooltip({
    children,
    content,
    delay = 300,
    className,
    contentId,
    anchor = 'trigger-center',
    placement = 'top',
}: TooltipProps): JSX.Element {
    const [visible, setVisible] = useState(false)
    const [closing, setClosing] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const [resolvedPlacement, setResolvedPlacement] = useState<ResolvedTooltipPlacement>('top')
    const timerRef = useRef<number | null>(null)
    const triggerRef = useRef<HTMLElement>(null)
    const tooltipRef = useRef<HTMLSpanElement>(null)
    const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null)

    const updatePosition = useCallback(() => {
        if (anchor === 'pointer-start' && pointerRef.current) {
            setCoords({
                top: pointerRef.current.clientY + 8,
                left: pointerRef.current.clientX + 8,
            })
            return
        }
        if (triggerRef.current) {
            const next = resolveTooltipPosition({
                rect: triggerRef.current.getBoundingClientRect(),
                placement,
                // 提示框隐藏时量不到宽度（display:none），先按 0 放到首选侧；显示后布局阶段再量一次纠正
                tooltipWidth: tooltipRef.current?.offsetWidth ?? 0,
                viewportWidth: ownerWindowOf(triggerRef.current).innerWidth,
            })
            setResolvedPlacement(next.placement)
            setCoords({ top: next.top, left: next.left })
        }
    }, [anchor, placement])

    // 侧向放置依赖提示框自身宽度：显示后（已可测量）在绘制前再定一次位
    useLayoutEffect(() => {
        if (!visible || closing || anchor !== 'trigger-center' || placement === 'top') return
        updatePosition()
    }, [anchor, closing, placement, updatePosition, visible])

    const handleMouseEnter = (event: React.MouseEvent) => {
        pointerRef.current = { clientX: event.clientX, clientY: event.clientY }
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
            updatePosition()
            setVisible(true)
            setClosing(false)
        }, delay)
    }

    const handleMouseMove = (event: React.MouseEvent) => {
        if (anchor !== 'pointer-start') return
        pointerRef.current = { clientX: event.clientX, clientY: event.clientY }
        if (visible && !closing) updatePosition()
    }

    const handleMouseLeave = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        if (visible) {
            setClosing(true)
            window.setTimeout(() => {
                setVisible(false)
                setClosing(false)
            }, UI_DURATION.slow) // 与 animate-fade-out（index.css）同档
        }
    }

    /*
     * 键盘路径：Tab 停到触发元素上立刻显示，不走 hover 的延迟。
     *
     * 没有这段时，只靠 hover 的说明对键盘用户完全不可达——参数名、设置项名称本身就是说明的触发器
     * （可聚焦），这就不是锦上添花而是必需品。React 的 onFocus/onBlur 会冒泡，
     * 所以挂在包裹元素上就能接住内部按钮的聚焦。
     */
    const handleFocus = () => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        updatePosition()
        setVisible(true)
        setClosing(false)
    }

    useEffect(() => {
        const handleScrollOrResize = () => {
            if (visible && !closing) {
                updatePosition()
            }
        }

        // 触发器可能挂在系统浮窗里：滚动与缩放按它所在的窗口监听。
        const ownerWindow = ownerWindowOf(triggerRef.current)
        ownerWindow.addEventListener('scroll', handleScrollOrResize, true)
        ownerWindow.addEventListener('resize', handleScrollOrResize)

        return () => {
            ownerWindow.removeEventListener('scroll', handleScrollOrResize, true)
            ownerWindow.removeEventListener('resize', handleScrollOrResize)
            if (timerRef.current) {
                window.clearTimeout(timerRef.current)
            }
        }
    }, [visible, closing, updatePosition])

    const tooltipContent = (
        <span
            ref={tooltipRef}
            id={contentId}
            role="tooltip"
            aria-hidden={!visible}
            data-tooltip-placement={anchor === 'trigger-center' ? resolvedPlacement : undefined}
            className={`fixed z-tooltip w-max max-w-[min(320px,calc(100vw-32px))] whitespace-normal text-left leading-5 bg-raised border border-line rounded-field shadow-panel text-xs text-text1 px-2.5 py-1.5 pointer-events-none ${anchor === 'trigger-center' ? TOOLTIP_PLACEMENT_TRANSFORM_CLASS[resolvedPlacement] : ''} ${visible ? (closing ? 'animate-fade-out' : 'animate-fade-in') : 'hidden'
                } ${className || ''}`}
            style={{
                top: coords.top,
                left: coords.left,
            }}
        >
            {content}
        </span>
    )

    // Extract className from children to apply to wrapper
    const childClassName = children.props.className || ''
    const shouldFlex = childClassName.includes('flex-1') || childClassName.includes('flex-grow')

    return (
        <>
            <span
                ref={triggerRef}
                className={`relative ${shouldFlex ? 'flex' : 'inline-block'} ${shouldFlex ? childClassName.match(/flex-\d+|flex-grow/)?.[0] || '' : ''}`}
                onMouseEnter={handleMouseEnter}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onFocus={handleFocus}
                onBlur={handleMouseLeave}
            >
                {children}
            </span>
            {/* 挂到触发器所在文档；首次渲染尚未挂载时落在主文档，悬停时随重渲染迁到浮窗。 */}
            {createPortal(tooltipContent, ownerDocumentOf(triggerRef.current).body)}
        </>
    )
}
