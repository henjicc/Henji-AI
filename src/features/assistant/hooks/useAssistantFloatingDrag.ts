import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { AssistantPanelPosition, AssistantPanelSize } from '../store/assistantUiStore'

const VIEWPORT_GAP = 12
const TITLEBAR_BOTTOM = 48

interface ViewportSize {
  width: number
  height: number
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

interface UseAssistantFloatingDragInput {
  enabled: boolean
  position: AssistantPanelPosition
  size: AssistantPanelSize
  onCommit: (position: AssistantPanelPosition) => void
}

interface UseAssistantFloatingDragResult {
  displayPosition: AssistantPanelPosition
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

export function useAssistantFloatingDrag({
  enabled,
  position,
  size,
  onCommit,
}: UseAssistantFloatingDragInput): UseAssistantFloatingDragResult {
  const [displayPosition, setDisplayPosition] = useState(position)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const disposeDragRef = useRef<(() => void) | null>(null)
  const displayPositionRef = useRef(displayPosition)
  displayPositionRef.current = displayPosition

  useEffect(() => {
    if (!dragRef.current) setDisplayPosition(position)
  }, [position])

  useEffect(() => () => disposeDragRef.current?.(), [])

  useEffect(() => {
    if (!enabled) return
    const clamp = (): void => {
      const next = clampAssistantFloatingPosition(displayPositionRef.current, size, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      setDisplayPosition(next)
      if (next.x !== position.x || next.y !== position.y) onCommit(next)
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [enabled, onCommit, position.x, position.y, size])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button,input,textarea,select,a,[data-assistant-drag-ignore]')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - displayPositionRef.current.x,
      offsetY: event.clientY - displayPositionRef.current.y,
    }
    setDragging(true)

    const onPointerMove = (pointerEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || pointerEvent.pointerId !== drag.pointerId) return
      setDisplayPosition(clampAssistantFloatingPosition({
        x: pointerEvent.clientX - drag.offsetX,
        y: pointerEvent.clientY - drag.offsetY,
      }, size, { width: window.innerWidth, height: window.innerHeight }))
    }
    const onPointerUp = (pointerEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || pointerEvent.pointerId !== drag.pointerId) return
      dragRef.current = null
      setDragging(false)
      onCommit(displayPositionRef.current)
      disposeDragRef.current?.()
    }
    disposeDragRef.current?.()
    disposeDragRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      disposeDragRef.current = null
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }, [enabled, onCommit, size])

  return { displayPosition, dragging, onPointerDown }
}
