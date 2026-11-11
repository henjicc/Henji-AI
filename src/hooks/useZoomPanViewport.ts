import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { wheelZoomFactor, zoomViewportAroundPoint, type ViewportPan, type ViewportZoomLimits } from '@/core/viewport/zoomPan'

const ZERO: ViewportPan = { x: 0, y: 0 }

export interface ZoomPanViewport {
  /** 相对“适合”的倍数：1 是整张放进视口。 */
  zoom: number
  pan: ViewportPan
  /** 按住空格（准备平移）或正在平移：调用方据此换成抓手光标，并暂停自己的绘制手势。 */
  panReady: boolean
  panning: boolean
  reset: () => void
}

/**
 * 画面视口的缩放平移手势：滚轮以指针为中心缩放，按住空格或中键拖动平移。
 * 手势在捕获阶段接住，平移时不会落到画面自己的绘制或拖动上；元素要带 nopan（不让画布跟着平移）与 nowheel。
 * clampPan 由调用方按画面尺寸收住平移范围，免得把画面拖出视口。
 */
export function useZoomPanViewport(
  surfaceRef: RefObject<HTMLElement>,
  options: { limits: ViewportZoomLimits; clampPan?: (pan: ViewportPan, zoom: number) => ViewportPan; resetKey?: unknown },
): ZoomPanViewport {
  const { limits, clampPan, resetKey } = options
  const [view, setView] = useState({ zoom: 1, pan: ZERO })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const clampRef = useRef(clampPan)
  clampRef.current = clampPan
  const hoverRef = useRef(false)
  const spaceRef = useRef(false)

  const apply = useCallback((zoom: number, pan: ViewportPan) => {
    setView({ zoom, pan: clampRef.current ? clampRef.current(pan, zoom) : pan })
  }, [])
  const reset = useCallback(() => setView({ zoom: 1, pan: ZERO }), [])

  useEffect(() => { reset() }, [reset, resetKey])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const centerOffset = (event: { clientX: number; clientY: number }): ViewportPan => {
      const rect = surface.getBoundingClientRect()
      return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const current = viewRef.current
      const next = zoomViewportAroundPoint(current.zoom, current.pan, current.zoom * wheelZoomFactor(event.deltaY), centerOffset(event), limits)
      apply(next.zoom, next.pan)
    }
    let drag: { pointerId: number; startX: number; startY: number; startPan: ViewportPan } | null = null
    const stop = (event: Event): void => { event.stopPropagation(); event.preventDefault() }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 1 && !(event.button === 0 && spaceRef.current)) return
      stop(event)
      surface.setPointerCapture(event.pointerId)
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPan: viewRef.current.pan }
      setPanning(true)
    }
    // 鼠标事件与指针事件分开派发：平移期间把 mousedown 也挡在捕获阶段，画面的绘制手势收不到
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 1 || (event.button === 0 && spaceRef.current)) stop(event)
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.pointerId) return
      stop(event)
      apply(viewRef.current.zoom, { x: drag.startPan.x + event.clientX - drag.startX, y: drag.startPan.y + event.clientY - drag.startY })
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.pointerId) return
      drag = null
      setPanning(false)
    }
    const onEnter = (): void => { hoverRef.current = true }
    const onLeave = (): void => { hoverRef.current = false }
    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('pointerdown', onPointerDown, true)
    surface.addEventListener('mousedown', onMouseDown, true)
    surface.addEventListener('pointermove', onPointerMove, true)
    surface.addEventListener('pointerup', onPointerUp, true)
    surface.addEventListener('pointercancel', onPointerUp, true)
    surface.addEventListener('pointerenter', onEnter)
    surface.addEventListener('pointerleave', onLeave)
    return () => {
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('pointerdown', onPointerDown, true)
      surface.removeEventListener('mousedown', onMouseDown, true)
      surface.removeEventListener('pointermove', onPointerMove, true)
      surface.removeEventListener('pointerup', onPointerUp, true)
      surface.removeEventListener('pointercancel', onPointerUp, true)
      surface.removeEventListener('pointerenter', onEnter)
      surface.removeEventListener('pointerleave', onLeave)
    }
  }, [apply, limits, surfaceRef])

  // 空格只在指针停在画面上时接管，不影响别处打字或按钮
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || !hoverRef.current || isTyping(event.target)) return
      event.preventDefault()
      if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true) }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || !spaceRef.current) return
      spaceRef.current = false
      setSpaceHeld(false)
    }
    const onBlur = (): void => { spaceRef.current = false; setSpaceHeld(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return { zoom: view.zoom, pan: view.pan, panReady: spaceHeld || panning, panning, reset }
}
