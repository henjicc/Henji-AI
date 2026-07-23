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

interface AssistantWorkspaceInsets {
  left: number
  right: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

function floatingTransform(position: AssistantPanelPosition): string {
  return `translate3d(${position.x}px, ${position.y}px, 0)`
}

export function getAssistantWorkspaceInsets(
  mode: AssistantDockMode,
  width: number
): AssistantWorkspaceInsets {
  return mode === 'left'
    ? { left: width, right: 0 }
    : mode === 'right'
      ? { left: 0, right: width }
      : { left: 0, right: 0 }
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
  workspaceRef: RefObject<HTMLDivElement>
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
  workspaceRef,
  onCommitPosition,
  onCommitSize,
}: UseAssistantPanelInteractionInput): UseAssistantPanelInteractionResult {
  const panelRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<AssistantPanelLayout>({ position, size })
  const disposeRef = useRef<(() => void) | null>(null)
  const transitionRestoreFrameRef = useRef<number | null>(null)
  const restoreTransitionRef = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState<AssistantResizeAxis | null>(null)

  const applyCommittedLayout = useCallback((layout: AssistantPanelLayout): void => {
    layoutRef.current = layout
    const panel = panelRef.current
    if (!panel) return
    panel.style.width = `${layout.size.width}px`
    panel.style.height = mode === 'floating' ? `${layout.size.height}px` : ''
    panel.style.transformOrigin = mode === 'right' ? 'top right' : 'top left'
    panel.style.transform = mode === 'floating'
      ? floatingTransform(layout.position)
      : 'translate3d(0, 0, 0)'
  }, [mode])

  const applyDragPreview = useCallback((layout: AssistantPanelLayout): void => {
    layoutRef.current = layout
    if (panelRef.current && mode === 'floating') {
      panelRef.current.style.transform = floatingTransform(layout.position)
    }
  }, [mode])

  const applyLiveResize = useCallback((next: AssistantPanelLayout): void => {
    // 所有尺寸读取在 pointermove 中完成；这里在同一动画帧批量写局部样式，
    // 不修改根级变量，也不触发 React/Zustand 的高频状态更新。
    layoutRef.current = next
    const panel = panelRef.current
    if (!panel) return
    panel.style.width = `${next.size.width}px`
    if (mode === 'floating') panel.style.height = `${next.size.height}px`
    const workspace = workspaceRef.current
    if (!workspace || mode === 'floating') return
    const insets = getAssistantWorkspaceInsets(mode, next.size.width)
    workspace.style.paddingLeft = `${insets.left}px`
    workspace.style.paddingRight = `${insets.right}px`
  }, [mode, workspaceRef])

  const commitLayout = useCallback((layout: AssistantPanelLayout): void => {
    if (!samePosition(layout.position, position)) onCommitPosition(layout.position)
    if (!sameSize(layout.size, size)) onCommitSize(layout.size)
  }, [onCommitPosition, onCommitSize, position, size])

  useLayoutEffect(() => {
    if (disposeRef.current) return
    const next = normalizeLayout(mode, { position, size }, currentViewport())
    applyCommittedLayout(next)
    commitLayout(next)
  }, [applyCommittedLayout, commitLayout, mode, position, size])

  useEffect(() => {
    const onViewportResize = (): void => {
      if (disposeRef.current) return
      const next = normalizeLayout(mode, layoutRef.current, currentViewport())
      applyCommittedLayout(next)
      commitLayout(next)
    }
    window.addEventListener('resize', onViewportResize)
    return () => window.removeEventListener('resize', onViewportResize)
  }, [applyCommittedLayout, commitLayout, mode])

  useEffect(() => () => {
    disposeRef.current?.()
    if (transitionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionRestoreFrameRef.current)
      transitionRestoreFrameRef.current = null
    }
    restoreTransitionRef.current?.()
  }, [])

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
    if (transitionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionRestoreFrameRef.current)
      transitionRestoreFrameRef.current = null
    }
    restoreTransitionRef.current?.()

    const initialLayout = layoutRef.current
    const startPoint = { x: event.clientX, y: event.clientY }
    let pendingLayout = initialLayout
    let frameId: number | null = null
    const rootStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const previousCursor = rootStyle.cursor
    const previousUserSelect = bodyStyle.userSelect
    const previousTransitionDuration = rootStyle.getPropertyValue('--assistant-layout-transition-duration')
    const restoreTransition = (): void => {
      if (previousTransitionDuration) {
        rootStyle.setProperty('--assistant-layout-transition-duration', previousTransitionDuration)
      } else {
        rootStyle.removeProperty('--assistant-layout-transition-duration')
      }
      restoreTransitionRef.current = null
    }
    restoreTransitionRef.current = restoreTransition
    rootStyle.cursor = kind === 'drag' ? 'grabbing' : axis === 'height' ? 'ns-resize' : axis === 'both' ? 'nwse-resize' : 'ew-resize'
    bodyStyle.userSelect = 'none'
    if (kind === 'resize') rootStyle.setProperty('--assistant-layout-transition-duration', '0ms')
    if (kind === 'drag') setDragging(true)
    else setResizing(axis)

    const flush = (): void => {
      frameId = null
      if (kind === 'resize') applyLiveResize(pendingLayout)
      else applyDragPreview(pendingLayout)
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
            x: initialLayout.position.x + delta.x,
            y: initialLayout.position.y + delta.y,
          }, initialLayout.size, currentViewport()),
          size: initialLayout.size,
        })
      } else {
        queueLayout(resizeAssistantPanelLayout(mode, axis, initialLayout, delta, currentViewport()))
      }
    }
    const cleanup = (deferTransitionRestore = false): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
      rootStyle.cursor = previousCursor
      bodyStyle.userSelect = previousUserSelect
      if (deferTransitionRestore) {
        transitionRestoreFrameRef.current = window.requestAnimationFrame(() => {
          transitionRestoreFrameRef.current = null
          restoreTransition()
        })
      } else {
        restoreTransition()
      }
      disposeRef.current = null
    }
    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== event.pointerId) return
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (kind === 'resize') applyLiveResize(pendingLayout)
      else applyCommittedLayout(pendingLayout)
      commitLayout(pendingLayout)
      setDragging(false)
      setResizing(null)
      cleanup(kind === 'resize')
    }
    disposeRef.current = () => cleanup(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [applyCommittedLayout, applyDragPreview, applyLiveResize, commitLayout, enabled, mode])

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
    applyCommittedLayout(next)
    commitLayout(next)
  }, [applyCommittedLayout, commitLayout, mode])

  return {
    panelRef,
    dragging,
    resizing,
    onDragPointerDown,
    onResizePointerDown,
    onResizeKeyDown,
  }
}
