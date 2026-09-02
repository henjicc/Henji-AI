import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorInteractionStoreV3 } from '../store'
import {
  imageEditorViewportTransformV3,
  zoomImageEditorViewportAroundPointV3,
  type ImageEditorNavigationGestureV3,
  type ImageEditorViewportPanV3,
} from './viewportNavigationV3'
import { useImageEditorViewportWheelV3 } from './useImageEditorViewportWheelV3'

const ZERO_PAN: ImageEditorViewportPanV3 = { x: 0, y: 0 }

export function useImageEditorViewportNavigationGestureV3(
  sessionId: string,
  activeTool: ImageEditorToolIdV3,
  surfaceRef: RefObject<HTMLElement>,
  viewportContentRef: RefObject<HTMLDivElement>,
  zoom: number,
  pan: ImageEditorViewportPanV3,
  onViewportTransform?: (
    zoom: number,
    pan: ImageEditorViewportPanV3,
    interacting: boolean,
  ) => void,
) {
  const gestureRef = useRef<ImageEditorNavigationGestureV3 | null>(null)
  const setViewportPan = useImageEditorInteractionStoreV3((state) => state.setViewportPan)
  const setViewportTransform = useImageEditorInteractionStoreV3((state) => state.setViewportTransform)

  const applyViewportTransform = useCallback((
    nextZoom: number,
    nextPan: ImageEditorViewportPanV3,
    interacting = false,
  ): void => {
    const content = viewportContentRef.current
    if (content) content.style.transform = imageEditorViewportTransformV3(nextZoom, nextPan)
    onViewportTransform?.(nextZoom, nextPan, interacting)
  }, [onViewportTransform, viewportContentRef])

  useEffect(() => {
    if (!gestureRef.current) applyViewportTransform(zoom, pan)
  }, [applyViewportTransform, pan, zoom])

  useEffect(() => {
    if (activeTool !== 'crop') return
    gestureRef.current = null
    setViewportTransform(sessionId, { zoom: 1, pan: ZERO_PAN })
    applyViewportTransform(1, ZERO_PAN)
  }, [activeTool, applyViewportTransform, sessionId, setViewportTransform])

  const zoomAroundClientPoint = useCallback((
    clientX: number,
    clientY: number,
    requestedZoom: number,
  ): void => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const next = zoomImageEditorViewportAroundPointV3(zoom, pan, requestedZoom, {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    })
    setViewportTransform(sessionId, next)
  }, [pan, sessionId, setViewportTransform, surfaceRef, zoom])

  const releaseGesture = useCallback((commit: boolean): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    const surface = surfaceRef.current
    if (surface?.hasPointerCapture(gesture.pointerId)) {
      surface.releasePointerCapture(gesture.pointerId)
    }
    if (viewportContentRef.current) viewportContentRef.current.style.willChange = ''
    if (commit && gesture.kind === 'pan') {
      setViewportPan(sessionId, gesture.pendingPan)
      return
    }
    if (commit && gesture.kind === 'zoom') {
      setViewportTransform(sessionId, { zoom: gesture.pendingZoom, pan: gesture.pendingPan })
      return
    }
    applyViewportTransform(zoom, pan)
  }, [applyViewportTransform, pan, sessionId, setViewportPan, setViewportTransform, surfaceRef, viewportContentRef, zoom])

  useEffect(() => {
    if (activeTool !== 'hand' && activeTool !== 'zoom') releaseGesture(false)
  }, [activeTool, releaseGesture])
  useEffect(() => () => releaseGesture(false), [releaseGesture])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (
      event.button !== 0
      || !event.isPrimary
      || (activeTool !== 'hand' && activeTool !== 'zoom')
      || (event.target instanceof Element && event.target.closest('[data-viewport-control]'))
    ) return
    event.preventDefault()
    releaseGesture(false)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointercancel 兜底 */ }
    const rect = event.currentTarget.getBoundingClientRect()
    gestureRef.current = {
      kind: activeTool === 'hand' ? 'pan' : 'zoom',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: { ...pan },
      pendingPan: { ...pan },
      startZoom: zoom,
      pendingZoom: zoom,
      anchorPoint: {
        x: event.clientX - (rect.left + rect.width / 2),
        y: event.clientY - (rect.top + rect.height / 2),
      },
      zoomOutModifier: event.altKey || event.ctrlKey || event.metaKey,
      moved: false,
    }
    if (viewportContentRef.current) viewportContentRef.current.style.willChange = 'transform'
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const deltaX = event.clientX - gesture.startClientX
    const deltaY = event.clientY - gesture.startClientY
    if (deltaX * deltaX + deltaY * deltaY > 9) gesture.moved = true
    event.preventDefault()
    if (gesture.kind === 'pan') {
      gesture.pendingPan = { x: gesture.startPan.x + deltaX, y: gesture.startPan.y + deltaY }
      applyViewportTransform(gesture.startZoom, gesture.pendingPan, true)
      return
    }
    const next = zoomImageEditorViewportAroundPointV3(
      gesture.startZoom,
      gesture.startPan,
      gesture.startZoom * (2 ** (deltaX / 180)),
      gesture.anchorPoint,
    )
    gesture.pendingZoom = next.zoom
    gesture.pendingPan = next.pan
    applyViewportTransform(next.zoom, next.pan, true)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    if (gesture.kind === 'zoom' && !gesture.moved) {
      const requestedZoom = gesture.zoomOutModifier
        ? gesture.startZoom / 1.25
        : gesture.startZoom * 1.25
      releaseGesture(false)
      zoomAroundClientPoint(event.clientX, event.clientY, requestedZoom)
      return
    }
    releaseGesture(true)
  }

  useImageEditorViewportWheelV3(surfaceRef, activeTool, zoom, zoomAroundClientPoint)

  const zoomFromCenter = (requestedZoom: number): void => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAroundClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, requestedZoom)
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => releaseGesture(false),
    zoomFromCenter,
  }
}
