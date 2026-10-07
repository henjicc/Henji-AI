import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'
import { UI_DURATION } from './motion'
import { resolveTooltipPosition, TOOLTIP_VIEWPORT_GUTTER_PX, type TooltipAnchorRect, type TooltipPlacement } from './tooltipPosition'

export type { TooltipPlacement } from './tooltipPosition'

interface TooltipContentProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'content' | 'children'> {
    anchorRef: React.RefObject<HTMLElement>
    content: React.ReactNode
    visible?: boolean
    closing?: boolean
    placement?: TooltipPlacement
    /** 跟随读数等自绘提示用视口坐标；不传则锚定元素本身。 */
    getAnchorRect?: () => TooltipAnchorRect
    alignment?: 'center' | 'start'
    interactive?: boolean
}

/** Tooltip 的唯一浮层实现；拖动读数也复用尺寸测量、跨文档 portal 和视口定位。 */
export function TooltipContent({ anchorRef, content, visible = true, closing = false, placement = 'top', getAnchorRect, alignment = 'center', interactive = false, className = '', ...props }: TooltipContentProps): JSX.Element {
    const tooltipRef = useRef<HTMLSpanElement>(null)
    const [position, setPosition] = useState({ top: 0, left: 0, placement })
    const updatePosition = useCallback(() => {
        const trigger = anchorRef.current
        const tooltip = tooltipRef.current
        if (!trigger || !tooltip) return
        const ownerWindow = ownerWindowOf(trigger)
        // 先应用当前窗口的尺寸限制，再量换行后的真实尺寸，避免缩小窗口后仍使用旧高度。
        tooltip.style.maxWidth = `${Math.min(320, Math.max(0, ownerWindow.innerWidth - TOOLTIP_VIEWPORT_GUTTER_PX * 2))}px`
        tooltip.style.maxHeight = `${Math.max(0, ownerWindow.innerHeight - TOOLTIP_VIEWPORT_GUTTER_PX * 2)}px`
        const next = resolveTooltipPosition({
            rect: getAnchorRect?.() ?? trigger.getBoundingClientRect(), placement, alignment,
            tooltipWidth: tooltip.offsetWidth, tooltipHeight: tooltip.offsetHeight,
            viewportWidth: ownerWindow.innerWidth, viewportHeight: ownerWindow.innerHeight,
        })
        setPosition(previous => previous.top === next.top && previous.left === next.left && previous.placement === next.placement ? previous : next)
    }, [anchorRef, getAnchorRect, placement, alignment])

    useLayoutEffect(() => {
        if (!visible) return
        updatePosition()
        const ownerWindow = ownerWindowOf(anchorRef.current)
        ownerWindow.addEventListener('scroll', updatePosition, true)
        ownerWindow.addEventListener('resize', updatePosition)
        const observer = typeof ownerWindow.ResizeObserver === 'function' ? new ownerWindow.ResizeObserver(updatePosition) : undefined
        if (tooltipRef.current) observer?.observe(tooltipRef.current)
        if (anchorRef.current) observer?.observe(anchorRef.current)
        return () => {
            observer?.disconnect()
            ownerWindow.removeEventListener('scroll', updatePosition, true)
            ownerWindow.removeEventListener('resize', updatePosition)
        }
    }, [visible, content, anchorRef, updatePosition])

    return createPortal(
        <span {...props} ref={tooltipRef} role={props.role ?? 'tooltip'} aria-hidden={!visible}
            data-tooltip-placement={position.placement}
            className={`fixed z-tooltip box-border w-max whitespace-normal [overflow-wrap:anywhere] overflow-auto overscroll-contain text-left leading-5 bg-raised border border-line rounded-field shadow-panel text-xs text-text1 px-2.5 py-1.5 ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} ${visible ? closing ? 'animate-fade-out' : 'animate-fade-in' : 'hidden'} ${className}`}
            style={{ ...props.style, top: position.top, left: position.left }}>
            {content}
        </span>, ownerDocumentOf(anchorRef.current).body,
    )
}

type TooltipProps = {
    children: React.ReactElement
    content: React.ReactNode
    /** 悬停多久出现（ms），默认 300；键盘聚焦立即出现。 */
    delay?: number
    className?: string
    contentId?: string
    anchor?: 'trigger-center' | 'pointer-start'
    placement?: TooltipPlacement
}

export default function Tooltip({ children, content, delay = 300, className, contentId, anchor = 'trigger-center', placement = 'top' }: TooltipProps): JSX.Element {
    const [visible, setVisible] = useState(false)
    const [closing, setClosing] = useState(false)
    const triggerRef = useRef<HTMLElement>(null)
    const showTimerRef = useRef<number | null>(null)
    const hideTimerRef = useRef<number | null>(null)
    // 卸载时 DOM ref 已可能清空，仍需在创建计时器的窗口取消计时。
    const timerWindowRef = useRef<Window | null>(null)
    const [pointer, setPointer] = useState<{ clientX: number; clientY: number } | null>(null)
    const clearTimers = useCallback(() => {
        const ownerWindow = timerWindowRef.current ?? ownerWindowOf(triggerRef.current)
        if (showTimerRef.current !== null) ownerWindow.clearTimeout(showTimerRef.current)
        if (hideTimerRef.current !== null) ownerWindow.clearTimeout(hideTimerRef.current)
        showTimerRef.current = null
        hideTimerRef.current = null
    }, [])
    useEffect(() => clearTimers, [clearTimers])

    const show = () => {
        clearTimers()
        setVisible(true)
        setClosing(false)
    }
    const handleMouseEnter = (event: React.MouseEvent) => {
        setPointer({ clientX: event.clientX, clientY: event.clientY })
        clearTimers()
        setClosing(false)
        timerWindowRef.current = ownerWindowOf(triggerRef.current)
        showTimerRef.current = timerWindowRef.current.setTimeout(show, delay)
    }
    const handleMouseLeave = () => {
        clearTimers()
        if (!visible) return
        setClosing(true)
        timerWindowRef.current = ownerWindowOf(triggerRef.current)
        hideTimerRef.current = timerWindowRef.current.setTimeout(() => {
            setVisible(false)
            setClosing(false)
            hideTimerRef.current = null
        }, UI_DURATION.slow)
    }
    const getPointerRect = useCallback((): TooltipAnchorRect => {
        if (!pointer) return triggerRef.current!.getBoundingClientRect()
        return { top: pointer.clientY, left: pointer.clientX, right: pointer.clientX, width: 0, height: 0 }
    }, [pointer])
    const childClassName = children.props.className || ''
    const shouldFlex = childClassName.includes('flex-1') || childClassName.includes('flex-grow')

    return <>
        <span ref={triggerRef}
            className={`relative ${shouldFlex ? 'flex' : 'inline-block'} ${shouldFlex ? childClassName.match(/flex-\d+|flex-grow/)?.[0] || '' : ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseMove={event => { if (anchor === 'pointer-start') setPointer({ clientX: event.clientX, clientY: event.clientY }) }}
            onMouseLeave={handleMouseLeave} onFocus={show} onBlur={handleMouseLeave}
            onKeyDown={event => { if (event.key === 'Escape' && visible) { clearTimers(); setVisible(false); setClosing(false) } }}>
            {children}
        </span>
        <TooltipContent anchorRef={triggerRef} content={content} id={contentId} className={className}
            visible={visible} closing={closing} placement={anchor === 'pointer-start' && pointer ? 'bottom' : placement}
            getAnchorRect={anchor === 'pointer-start' ? getPointerRect : undefined}
            alignment={anchor === 'pointer-start' && pointer ? 'start' : 'center'}
/>
    </>
}
