import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'
import { UI_DURATION } from './motion'
import { useDialogTransition } from './useDialogTransition'
import { resolveTooltipPosition, TOOLTIP_VIEWPORT_GUTTER_PX, type TooltipAnchorRect, type TooltipPlacement } from './tooltipPosition'

/** 最近一次输入是不是指针（按文档记录，跨窗口浮出的面板各算各的）：键盘导航带来的聚焦才显示说明，等同浏览器的 :focus-visible 判断。 */
const pointerModality = new WeakMap<Document, boolean>()
function lastInputWasPointer(node: Node): boolean {
    const doc = node.ownerDocument ?? (node as Document)
    if (!pointerModality.has(doc)) {
        pointerModality.set(doc, false)
        doc.addEventListener('pointerdown', () => pointerModality.set(doc, true), true)
        doc.addEventListener('keydown', () => pointerModality.set(doc, false), true)
    }
    return pointerModality.get(doc) === true
}
// 主窗口启动即开始记录，避免第一次点击发生在登记之前。
if (typeof document !== 'undefined') lastInputWasPointer(document)

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
        <span {...props} ref={tooltipRef} role={props.role ?? 'tooltip'} aria-hidden={!visible || closing}
            {...(closing ? { inert: '' } : {})}
            data-tooltip-placement={position.placement}
            className={`fixed z-tooltip box-border w-max whitespace-normal [overflow-wrap:anywhere] overflow-auto overscroll-contain text-left leading-5 bg-raised border border-line rounded-field shadow-panel text-xs text-text1 px-3 py-1.5 ${interactive && visible && !closing ? 'pointer-events-auto' : 'pointer-events-none'} ${visible ? closing ? 'animate-fade-out' : 'animate-fade-in' : 'hidden'} ${className}`}
            style={{ ...props.style, top: position.top, left: position.left }}>
            {content}
        </span>, ownerDocumentOf(anchorRef.current).body,
    )
}

type TooltipProps = {
    /** 直接使用子元素作触发器，保持按钮的 flex/grid 布局与 ref。 */
    asChild?: boolean
    children: React.ReactElement
    content: React.ReactNode
    /** 悬停多久出现（ms），默认 300；键盘聚焦立即出现。 */
    delay?: number
    className?: string
    contentId?: string
    anchor?: 'trigger-center' | 'pointer-start'
    placement?: TooltipPlacement
}

export default function Tooltip({ children, content, delay = 300, className, contentId, anchor = 'trigger-center', placement = 'top', asChild = false }: TooltipProps): JSX.Element {
    const [open, setOpen] = useState(false)
    const { shouldRender: visible, closing, onAnimationEnd } = useDialogTransition(open, UI_DURATION.slow)
    const triggerRef = useRef<HTMLElement | null>(null)
    const childRef = (children as React.ReactElement & { ref?: React.Ref<HTMLElement> }).ref
    const setTriggerRef = useCallback((node: HTMLElement | null) => {
        triggerRef.current = node
        if (typeof childRef === 'function') childRef(node)
        else if (childRef) (childRef as React.MutableRefObject<HTMLElement | null>).current = node
    }, [childRef])
    const showTimerRef = useRef<number | null>(null)
    // 卸载时 DOM ref 已可能清空，仍需在创建计时器的窗口取消计时。
    const timerWindowRef = useRef<Window | null>(null)
    const [pointer, setPointer] = useState<{ clientX: number; clientY: number } | null>(null)
    const clearTimers = useCallback(() => {
        const ownerWindow = timerWindowRef.current ?? ownerWindowOf(triggerRef.current)
        if (showTimerRef.current !== null) ownerWindow.clearTimeout(showTimerRef.current)
        showTimerRef.current = null
    }, [])
    useEffect(() => clearTimers, [clearTimers])

    // 触发器展开着自己的浮层（菜单、面板）时不显示说明：浮层已经说明了一切，说明框只会压在浮层上。
    const expanded = (): boolean => {
        const node = triggerRef.current
        return Boolean(node && (node.getAttribute('aria-expanded') === 'true' || node.querySelector('[aria-expanded="true"]')))
    }
    // 点过一次后，直到指针离开再进来之前都不再显示：点击常常打开弹窗或面板，说明不该再冒出来压在上面。
    const pressedRef = useRef(false)
    const show = () => {
        clearTimers()
        if (!content || expanded() || pressedRef.current) return
        setOpen(true)
    }
    const dismiss = () => { clearTimers(); setOpen(false); pressedRef.current = true }
    // 聚焦只在键盘导航（显示焦点框）时显示说明；鼠标点击带来的聚焦不显示。
    const showOnFocus = (event: React.FocusEvent) => {
        if (lastInputWasPointer(event.target as Node)) return
        show()
    }
    // 浮层是点击后才展开的：每次渲染后再看一眼，展开了就收起说明。
    useEffect(() => { if (open && expanded()) dismiss() })
    const handleMouseEnter = (event: React.MouseEvent) => {
        if (!content) return
        setPointer({ clientX: event.clientX, clientY: event.clientY })
        clearTimers()
        if (visible) { show(); return }
        timerWindowRef.current = ownerWindowOf(triggerRef.current)
        showTimerRef.current = timerWindowRef.current.setTimeout(show, delay)
    }
    const handleMouseLeave = () => {
        clearTimers()
        pressedRef.current = false
        if (!visible) return
        setOpen(false)
    }
    const getPointerRect = useCallback((): TooltipAnchorRect => {
        if (!pointer) return triggerRef.current!.getBoundingClientRect()
        return { top: pointer.clientY, left: pointer.clientX, right: pointer.clientX, width: 0, height: 0 }
    }, [pointer])
    const childClassName = children.props.className || ''
    const shouldFlex = childClassName.includes('flex-1') || childClassName.includes('flex-grow')

    const triggerEvents: React.HTMLAttributes<HTMLElement> = {
        onMouseEnter: handleMouseEnter,
        onMouseMove: event => { if (anchor === 'pointer-start') setPointer({ clientX: event.clientX, clientY: event.clientY }) },
        onMouseLeave: handleMouseLeave, onFocus: showOnFocus, onBlur: handleMouseLeave,
        onPointerDown: dismiss,
        onKeyDown: event => { if (event.key === 'Escape' && visible) { clearTimers(); setOpen(false) } },
    }
    const childEvents = children.props as React.HTMLAttributes<HTMLElement>
    const composedEvents: React.HTMLAttributes<HTMLElement> = {
        onMouseEnter: event => { childEvents.onMouseEnter?.(event); triggerEvents.onMouseEnter?.(event) },
        onMouseMove: event => { childEvents.onMouseMove?.(event); triggerEvents.onMouseMove?.(event) },
        onMouseLeave: event => { childEvents.onMouseLeave?.(event); triggerEvents.onMouseLeave?.(event) },
        onPointerDown: event => { childEvents.onPointerDown?.(event); triggerEvents.onPointerDown?.(event) },
        onFocus: event => { childEvents.onFocus?.(event); triggerEvents.onFocus?.(event) },
        onBlur: event => { childEvents.onBlur?.(event); triggerEvents.onBlur?.(event) },
        onKeyDown: event => { childEvents.onKeyDown?.(event); triggerEvents.onKeyDown?.(event) },
    }

    return <>
        {asChild ? React.cloneElement(children, { ...composedEvents, ref: setTriggerRef }) : <span ref={triggerRef}
            className={`relative ${shouldFlex ? 'flex' : 'inline-block'} ${shouldFlex ? childClassName.match(/flex-\d+|flex-grow/)?.[0] || '' : ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseMove={event => { if (anchor === 'pointer-start') setPointer({ clientX: event.clientX, clientY: event.clientY }) }}
            onMouseLeave={handleMouseLeave} onFocus={showOnFocus} onBlur={handleMouseLeave} onPointerDown={dismiss}
            onKeyDown={event => { if (event.key === 'Escape' && visible) { clearTimers(); setOpen(false) } }}>
            {children}
        </span>}
        {visible && content ? <TooltipContent anchorRef={triggerRef} content={content} id={contentId} className={className}
            visible={visible} closing={closing} onAnimationEnd={onAnimationEnd} placement={anchor === 'pointer-start' && pointer ? 'bottom' : placement}
            getAnchorRect={anchor === 'pointer-start' ? getPointerRect : undefined}
            alignment={anchor === 'pointer-start' && pointer ? 'start' : 'center'}
/> : null}
    </>
}
