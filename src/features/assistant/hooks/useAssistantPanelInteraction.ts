import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import type {
  AssistantDockMode,
  AssistantPanelPosition,
  AssistantPanelSize,
} from '../store/assistantUiStore'

const VIEWPORT_GAP = 12
const TITLEBAR_BOTTOM = 48
const PANEL_MIN_WIDTH = 320
const PANEL_MIN_HEIGHT = 320
const MIN_WORKSPACE_WIDTH = 320

interface ViewportSize {
  width: number
  height: number
}

interface AssistantPanelLayout {
  position: AssistantPanelPosition
  size: AssistantPanelSize
}

export type AssistantResizeAxis = 'width' | 'height' | 'both'

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function clampAssistantFloatingPosition(
  position: AssistantPanelPosition,
  size: AssistantPanelSize,
  viewport: ViewportSize
): AssistantPanelPosition {
  const maxX = Math.max(VIEWPORT_GAP, viewport.width - Math.min(size.width, viewport.width) - VIEWPORT_GAP)
  const maxY = Math.max(TITLEBAR_BOTTOM, viewport.height - Math.min(size.height, viewport.height) - VIEWPORT_GAP)
  return {
    x: Math.min(Math.max(position.x, VIEWPORT_GAP), maxX),
    y: Math.min(Math.max(position.y, TITLEBAR_BOTTOM), maxY),
  }
}

export function clampAssistantPanelSize(
  mode: AssistantDockMode,
  size: AssistantPanelSize,
  position: AssistantPanelPosition,
  viewport: ViewportSize
): AssistantPanelSize {
  const minWidth = Math.min(PANEL_MIN_WIDTH, Math.max(1, viewport.width - VIEWPORT_GAP * 2))
  const minHeight = Math.min(PANEL_MIN_HEIGHT, Math.max(1, viewport.height - TITLEBAR_BOTTOM - VIEWPORT_GAP))
  const maxWidth = mode === 'floating'
    ? Math.max(minWidth, viewport.width - position.x - VIEWPORT_GAP)
    : Math.max(minWidth, viewport.width - MIN_WORKSPACE_WIDTH)
  const maxHeight = mode === 'floating'
    ? Math.max(minHeight, viewport.height - position.y - VIEWPORT_GAP)
    : Math.max(minHeight, viewport.height - TITLEBAR_BOTTOM - VIEWPORT_GAP)
  return {
    width: Math.round(clamp(size.width, minWidth, maxWidth)),
    height: Math.round(clamp(size.height, minHeight, maxHeight)),
  }
}

function normalizeLayout(
  mode: AssistantDockMode,
  layout: AssistantPanelLayout,
  viewport: ViewportSize
): AssistantPanelLayout {
  if (mode !== 'floating') {
    return {
      position: layout.position,
      size: clampAssistantPanelSize(mode, layout.size, layout.position, viewport),
    }
  }
  let position = clampAssistantFloatingPosition(layout.position, layout.size, viewport)
  const size = clampAssistantPanelSize(mode, layout.size, position, viewport)
  position = clampAssistantFloatingPosition(position, size, viewport)
  return { position, size }
}

export function resizeAssistantPanelLayout(
  mode: AssistantDockMode,
  axis: AssistantResizeAxis,
  layout: AssistantPanelLayout,
  delta: AssistantPanelPosition,
  viewport: ViewportSize
): AssistantPanelLayout {
  const widthDelta = mode === 'right' ? -delta.x : delta.x
  const desiredSize = {
    width: layout.size.width + (axis === 'height' ? 0 : widthDelta),
    height: layout.size.height + (axis === 'width' ? 0 : delta.y),
  }
  return normalizeLayout(mode, { position: layout.position, size: desiredSize }, viewport)
}

interface UseAssistantPanelInteractionInput {
  enabled: boolean
  mode: AssistantDockMode
  position: AssistantPanelPosition
  size: AssistantPanelSize
  onCommitPosition: (position: AssistantPanelPosition) => void
  onCommitSize: (size: AssistantPanelSize) => void
}

interface UseAssistantPanelInteractionResult {
  panelRef: RefObject<HTMLDivElement>
  dragging: boolean
  resizing: AssistantResizeAxis | null
  onDragPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, axis: AssistantResizeAxis) => void
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLElement>, axis: AssistantResizeAxis) => void
}

function samePosition(left: AssistantPanelPosition, right: AssistantPanelPosition): boolean {
  return left.x === right.x && left.y === right.y
}

function sameSize(left: AssistantPanelSize, right: AssistantPanelSize): boolean {
  return left.width === right.width && left.height === right.height
}

export function useAssistantPanelInteraction({
  enabled,
  mode,
  position,
  size,
  onCommitPosition,
  onCommitSize,
}: UseAssistantPanelInteractionInput): UseAssistantPanelInteractionResult {
  const panelRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<AssistantPanelLayout>({ position, size })
  const appliedLayoutRef = useRef<AssistantPanelLayout | null>(null)
  const disposeRef = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState<AssistantResizeAxis | null>(null)

  const applyVisualLayout = useCallback((layout: AssistantPanelLayout): void => {
    const previous = appliedLayoutRef.current
    layoutRef.current = layout
    appliedLayoutRef.current = layout
    if (!previous || !sameSize(previous.size, layout.size)) {
      const rootStyle = document.documentElement.style
      rootStyle.setProperty('--assistant-panel-width', `${layout.size.width}px`)
      rootStyle.setProperty('--assistant-panel-height', `${layout.size.height}px`)
    }
    if (panelRef.current && mode === 'floating' && (!previous || !samePosition(previous.position, layout.position))) {
      panelRef.current.style.transform = `translate3d(${layout.position.x}px, ${layout.position.y}px, 0)`
    }
  }, [mode])

  const commitLayout = useCallback((layout: AssistantPanelLayout): void => {
    if (!samePosition(layout.position, position)) onCommitPosition(layout.position)
    if (!sameSize(layout.size, size)) onCommitSize(layout.size)
  }, [onCommitPosition, onCommitSize, position, size])

  useLayoutEffect(() => {
    if (disposeRef.current) return
    const next = normalizeLayout(mode, { position, size }, currentViewport())
    applyVisualLayout(next)
    commitLayout(next)
  }, [applyVisualLayout, commitLayout, mode, position, size])

  useEffect(() => {
    const onViewportResize = (): void => {
      if (disposeRef.current) return
      const next = normalizeLayout(mode, layoutRef.current, currentViewport())
      applyVisualLayout(next)
      commitLayout(next)
    }
    window.addEventListener('resize', onViewportResize)
    return () => window.removeEventListener('resize', onViewportResize)
  }, [applyVisualLayout, commitLayout, mode])

  useEffect(() => () => disposeRef.current?.(), [])

  const startPointerInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    kind: 'drag' | 'resize',
    axis: AssistantResizeAxis = 'both'
  ): void => {
    if (!enabled || event.button !== 0) return
    if (kind === 'drag') {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button,input,textarea,select,a,[data-assistant-drag-ignore]')) return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    disposeRef.current?.()

    const startLayout = layoutRef.current
    const startPoint = { x: event.clientX, y: event.clientY }
    let pendingLayout = startLayout
    let frameId: number | null = null
    const rootStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const previousCursor = rootStyle.cursor
    const previousUserSelect = bodyStyle.userSelect
    const previousTransitionDuration = rootStyle.getPropertyValue('--assistant-layout-transition-duration')
    rootStyle.cursor = kind === 'drag' ? 'grabbing' : axis === 'height' ? 'ns-resize' : axis === 'both' ? 'nwse-resize' : 'ew-resize'
    bodyStyle.userSelect = 'none'
    if (kind === 'resize') rootStyle.setProperty('--assistant-layout-transition-duration', '0ms')
    if (kind === 'drag') setDragging(true)
    else setResizing(axis)

    const flush = (): void => {
      frameId = null
      applyVisualLayout(pendingLayout)
    }
    const queueLayout = (layout: AssistantPanelLayout): void => {
      pendingLayout = layout
      if (frameId === null) frameId = window.requestAnimationFrame(flush)
    }
    const onPointerMove = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== event.pointerId) return
      const delta = { x: pointerEvent.clientX - startPoint.x, y: pointerEvent.clientY - startPoint.y }
      if (kind === 'drag') {
        queueLayout({
          position: clampAssistantFloatingPosition({
            x: startLayout.position.x + delta.x,
            y: startLayout.position.y + delta.y,
          }, startLayout.size, currentViewport()),
          size: startLayout.size,
        })
      } else {
        queueLayout(resizeAssistantPanelLayout(mode, axis, startLayout, delta, currentViewport()))
      }
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
      rootStyle.cursor = previousCursor
      bodyStyle.userSelect = previousUserSelect
      if (previousTransitionDuration) {
        rootStyle.setProperty('--assistant-layout-transition-duration', previousTransitionDuration)
      } else {
        rootStyle.removeProperty('--assistant-layout-transition-duration')
      }
      disposeRef.current = null
    }
    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== event.pointerId) return
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      applyVisualLayout(pendingLayout)
      cleanup()
      commitLayout(pendingLayout)
      setDragging(false)
      setResizing(null)
    }
    disposeRef.current = cleanup
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [applyVisualLayout, commitLayout, enabled, mode])

  const onDragPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (mode === 'floating') startPointerInteraction(event, 'drag')
  }, [mode, startPointerInteraction])

  const onResizePointerDown = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    axis: AssistantResizeAxis
  ): void => startPointerInteraction(event, 'resize', axis), [startPointerInteraction])

  const onResizeKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    axis: AssistantResizeAxis
  ): void => {
    const step = event.shiftKey ? 32 : 16
    const widthChange = axis !== 'height'
      ? event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
      : 0
    const heightChange = axis !== 'width'
      ? event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
      : 0
    if (widthChange === 0 && heightChange === 0) return
    event.preventDefault()
    const pointerDelta = { x: mode === 'right' ? -widthChange : widthChange, y: heightChange }
    const next = resizeAssistantPanelLayout(mode, axis, layoutRef.current, pointerDelta, currentViewport())
    applyVisualLayout(next)
    commitLayout(next)
  }, [applyVisualLayout, commitLayout, mode])

  return {
    panelRef,
    dragging,
    resizing,
    onDragPointerDown,
    onResizePointerDown,
    onResizeKeyDown,
  }
}
