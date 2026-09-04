import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'

import { useImageEditorSessionStoreV3 } from '../store'
import type { AnnotationOutputGeometryV3 } from './annotationGeometryV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import {
  isImageEditLayerTransformableV3,
  mapImageEditOutputPointToLayerParentV3,
  resolveImageEditRasterLayerOutputBoundsV3,
  resolveImageEditLayerMoveUnavailableReasonV3,
  translateImageEditLayerTransformV3,
  type ImageEditLayerMoveUnavailableReasonV3,
} from './layerTransformV3'
import {
  createImageEditorDocumentSnapCandidatesV3,
  resolveImageEditorMoveSnapV3,
  type ImageEditorSnapGuideV3,
} from './imageEditorMoveSnappingV3'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorV3Controller } from './types'
import type { ImageEditorRenderSessionV3 } from '../execution/imageEditorRenderSessionV3'

interface ImageEditorLayerMoveGestureV3 {
  pointerId: number
  captureTarget: HTMLElement
  previewId: string
  layerId: string
  startParentPoint: readonly [number, number]
  startClientPoint: readonly [number, number]
  viewportRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  surfaceRect: Pick<DOMRect, 'left' | 'top'>
  startTransform: ImageEditTransformV3
  pendingTransform: ImageEditTransformV3
  previewFrameId: number | null
  previewSet: boolean
  interacted: boolean
  changed: boolean
  directLayerFeedback: boolean
  feedbackTarget: HTMLDivElement | null
  gpuTransient: boolean
  interactionSequence: number
  eventTimestamp: number
}

const EMPTY_LAYER_IDS_V3: readonly string[] = []

export interface ImageEditorLayerMoveGestureHandlersV3 {
  unavailableReason: ImageEditLayerMoveUnavailableReasonV3 | null
  onPointerDownCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerMoveCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerUpCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerCancelCapture(event: ReactPointerEvent<HTMLElement>): void
}

export interface ImageEditorMoveSnapGuideRefsV3 {
  horizontal: RefObject<HTMLDivElement>
  vertical: RefObject<HTMLDivElement>
}

/** move 只变换当前单选图层；annotation overlay 仍负责对象选择和二次编辑。 */
export function useImageEditorLayerMoveGestureV3(
  controller: ImageEditorV3Controller,
  activeTool: ImageEditorToolIdV3,
  viewportContentRef: RefObject<HTMLDivElement>,
  acquireMoveFeedback: (layerId: string) => HTMLDivElement | null,
  releaseMoveFeedback: (committed: boolean) => void,
  outputGeometry: AnnotationOutputGeometryV3,
  snappingEnabled: boolean,
  snapGuideRefs: ImageEditorMoveSnapGuideRefsV3,
  renderSession: ImageEditorRenderSessionV3,
  gpuInteractionEnabled: boolean,
): ImageEditorLayerMoveGestureHandlersV3 {
  const gestureRef = useRef<ImageEditorLayerMoveGestureV3 | null>(null)
  const interactionSequenceRef = useRef(0)
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS_V3,
  )
  const selectedLocation = selectedLayerIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedLayerIds[0])
    : null
  const unavailableReason = resolveImageEditLayerMoveUnavailableReasonV3(selectedLocation)
  const snapCandidates = useMemo(() => createImageEditorDocumentSnapCandidatesV3(
    outputGeometry.width,
    outputGeometry.height,
  ), [outputGeometry.height, outputGeometry.width])

  const clearSnapGuides = useCallback((): void => {
    const horizontal = snapGuideRefs.horizontal.current
    const vertical = snapGuideRefs.vertical.current
    if (horizontal) horizontal.style.visibility = 'hidden'
    if (vertical) vertical.style.visibility = 'hidden'
  }, [snapGuideRefs.horizontal, snapGuideRefs.vertical])

  const updateSnapGuides = useCallback((
    gesture: ImageEditorLayerMoveGestureV3,
    guides: readonly ImageEditorSnapGuideV3[],
  ): void => {
    const horizontal = snapGuideRefs.horizontal.current
    const vertical = snapGuideRefs.vertical.current
    const frameLeft = gesture.viewportRect.left - gesture.surfaceRect.left
    const frameTop = gesture.viewportRect.top - gesture.surfaceRect.top
    const horizontalGuide = guides.find(({ axis }) => axis === 'y')
    const verticalGuide = guides.find(({ axis }) => axis === 'x')

    if (vertical) {
      if (verticalGuide) {
        vertical.style.left = `${frameLeft
          + verticalGuide.position / outputGeometry.width * gesture.viewportRect.width}px`
        vertical.style.top = `${frameTop}px`
        vertical.style.height = `${gesture.viewportRect.height}px`
        vertical.style.visibility = 'visible'
      } else {
        vertical.style.visibility = 'hidden'
      }
    }
    if (horizontal) {
      if (horizontalGuide) {
        horizontal.style.left = `${frameLeft}px`
        horizontal.style.top = `${frameTop
          + horizontalGuide.position / outputGeometry.height * gesture.viewportRect.height}px`
        horizontal.style.width = `${gesture.viewportRect.width}px`
        horizontal.style.visibility = 'visible'
      } else {
        horizontal.style.visibility = 'hidden'
      }
    }
  }, [outputGeometry.height, outputGeometry.width, snapGuideRefs.horizontal, snapGuideRefs.vertical])

  const cancelScheduledPreview = useCallback((gesture: ImageEditorLayerMoveGestureV3): void => {
    if (gesture.previewFrameId === null) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(gesture.previewFrameId)
    gesture.previewFrameId = null
  }, [])

  const release = useCallback((commit: boolean): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    cancelScheduledPreview(gesture)
    clearSnapGuides()
    if (
      typeof gesture.captureTarget.hasPointerCapture === 'function'
      && gesture.captureTarget.hasPointerCapture(gesture.pointerId)
      && typeof gesture.captureTarget.releasePointerCapture === 'function'
    ) gesture.captureTarget.releasePointerCapture(gesture.pointerId)
    if (gesture.gpuTransient) {
      interactionSequenceRef.current += 1
      renderSession.clearTransientLayerTransform(
        gesture.layerId,
        interactionSequenceRef.current,
      )
      renderSession.requestFrame('draft')
      if (commit && gesture.changed) {
        controller.updateLayerCommon(gesture.layerId, { transform: gesture.pendingTransform })
      }
      releaseMoveFeedback(false)
      return
    }
    if (commit && gesture.changed) {
      try {
        if (gesture.directLayerFeedback) {
          controller.updateLayerCommon(gesture.layerId, { transform: gesture.pendingTransform })
          releaseMoveFeedback(true)
        } else {
          if (!gesture.previewSet) {
            controller.setTransformPreview(
              gesture.previewId,
              gesture.layerId,
              gesture.pendingTransform,
            )
          }
          controller.commitTransformPreview(
            gesture.previewId,
            gesture.layerId,
            gesture.pendingTransform,
          )
        }
      } catch (error) {
        if (gesture.feedbackTarget) gesture.feedbackTarget.style.transform = ''
        releaseMoveFeedback(false)
        throw error
      }
    } else if (gesture.previewSet) {
      controller.clearTransformPreview(gesture.previewId)
      if (gesture.feedbackTarget) gesture.feedbackTarget.style.transform = ''
      releaseMoveFeedback(false)
    } else {
      if (gesture.feedbackTarget) gesture.feedbackTarget.style.transform = ''
      releaseMoveFeedback(false)
    }
  }, [
    cancelScheduledPreview,
    clearSnapGuides,
    controller,
    releaseMoveFeedback,
    renderSession,
  ])

  useEffect(() => {
    if (activeTool !== 'move') release(false)
  }, [activeTool, release])
  useEffect(() => () => release(false), [release])
  useEffect(() => {
    const gesture = gestureRef.current
    if (!gesture) return
    const location = findImageEditLayerLocationV3(controller.document.layers, gesture.layerId)
    if (!isImageEditLayerTransformableV3(location)) release(false)
  }, [controller.document.id, controller.document.revision, controller.document.layers, release])
  useEffect(() => {
    const gesture = gestureRef.current
    if (!gesture) return
    if (selectedLayerIds.length !== 1
      || selectedLayerIds[0] !== gesture.layerId
      || (gesture.gpuTransient && !gpuInteractionEnabled)) release(false)
  }, [gpuInteractionEnabled, release, selectedLayerIds])

  const clientToOutput = useCallback((
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    clientX: number,
    clientY: number,
    allowOutside = false,
  ): readonly [number, number] | null => {
    if (rect.width <= 0 || rect.height <= 0) return null
    const outside = (
      clientX < rect.left
      || clientX > rect.left + rect.width
      || clientY < rect.top
      || clientY > rect.top + rect.height
    )
    if (outside && !allowOutside) return null
    return [
      (clientX - rect.left) / rect.width * outputGeometry.width,
      (clientY - rect.top) / rect.height * outputGeometry.height,
    ]
  }, [outputGeometry.height, outputGeometry.width])

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    if (
      activeTool !== 'move'
      || event.button !== 0
      || !event.isPrimary
      || gestureRef.current
      || (event.target instanceof Element && event.target.closest('[data-viewport-control]'))
    ) return
    // 具体标注对象仍由 annotation overlay 选中和二次编辑；
    // 只在画布/非对象区域拖动当前单选图层。
    if (event.target instanceof Element && event.target.closest('[data-annotation-id]')) return
    if (
      selectedLocation?.layer.type === 'annotation'
      && event.target instanceof Element
      && event.target.closest('[data-annotation-editor-overlay]')
    ) return
    const layerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null
    if (!layerId) return
    const location = findImageEditLayerLocationV3(controller.document.layers, layerId)
    const viewportRect = viewportContentRef.current?.getBoundingClientRect()
    const surfaceRect = event.currentTarget.getBoundingClientRect()
    if (!viewportRect) return
    const outputPoint = clientToOutput(viewportRect, event.clientX, event.clientY)
    if (!isImageEditLayerTransformableV3(location) || !outputPoint) return
    const feedbackTarget = !gpuInteractionEnabled
      && location.parentId === null && location.layer.type === 'raster'
      ? acquireMoveFeedback(layerId)
      : null
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // pointercancel/unmount 会负责清理 PreviewOverride。
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      previewId: `${controller.sessionId}:${layerId}:move`,
      layerId,
      startParentPoint: mapImageEditOutputPointToLayerParentV3(
        controller.document,
        location,
        outputPoint,
      ),
      startClientPoint: [event.clientX, event.clientY],
      viewportRect: {
        left: viewportRect.left,
        top: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      },
      surfaceRect: { left: surfaceRect.left, top: surfaceRect.top },
      startTransform: [...location.layer.transform],
      pendingTransform: [...location.layer.transform],
      previewFrameId: null,
      previewSet: false,
      interacted: false,
      changed: false,
      directLayerFeedback: feedbackTarget !== null,
      feedbackTarget,
      gpuTransient: gpuInteractionEnabled,
      interactionSequence: interactionSequenceRef.current,
      eventTimestamp: typeof performance === 'undefined' ? Date.now() : performance.now(),
    }
  }

  const onPointerMoveCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const location = findImageEditLayerLocationV3(controller.document.layers, gesture.layerId)
    const outputPoint = clientToOutput(
      gesture.viewportRect,
      event.clientX,
      event.clientY,
      true,
    )
    if (!isImageEditLayerTransformableV3(location) || !outputPoint) {
      release(false)
      return
    }
    const rawPoint = mapImageEditOutputPointToLayerParentV3(controller.document, location, outputPoint)
    const rawDeltaX = rawPoint[0] - gesture.startParentPoint[0]
    const rawDeltaY = rawPoint[1] - gesture.startParentPoint[1]
    const rawChanged = Math.hypot(rawDeltaX, rawDeltaY) >= 0.01
    const rawTransform = translateImageEditLayerTransformV3(
      gesture.startTransform,
      rawDeltaX,
      rawDeltaY,
    )
    const movingBounds = snappingEnabled && !event.ctrlKey
      ? resolveImageEditRasterLayerOutputBoundsV3(controller.document, location, rawTransform)
      : null
    const snap = movingBounds
      ? resolveImageEditorMoveSnapV3(
          movingBounds,
          snapCandidates,
          {
            x: 8 / gesture.viewportRect.width * outputGeometry.width,
            y: 8 / gesture.viewportRect.height * outputGeometry.height,
          },
        )
      : { deltaX: 0, deltaY: 0, guides: [] }
    const snappedOutputPoint: readonly [number, number] = [
      outputPoint[0] + snap.deltaX,
      outputPoint[1] + snap.deltaY,
    ]
    const point = mapImageEditOutputPointToLayerParentV3(
      controller.document,
      location,
      snappedOutputPoint,
    )
    const deltaX = point[0] - gesture.startParentPoint[0]
    const deltaY = point[1] - gesture.startParentPoint[1]
    const changed = Math.hypot(deltaX, deltaY) >= 0.01
    if (!rawChanged && !gesture.interacted) return
    event.preventDefault()
    event.stopPropagation()
    gesture.interacted = true
    gesture.changed = changed
    updateSnapGuides(gesture, snap.guides)
    gesture.pendingTransform = changed
      ? translateImageEditLayerTransformV3(gesture.startTransform, deltaX, deltaY)
      : [...gesture.startTransform]
    gesture.eventTimestamp = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (gesture.gpuTransient) {
      if (gesture.previewFrameId !== null) return
      const publishGpuFrame = (): void => {
        const current = gestureRef.current
        if (current !== gesture) return
        gesture.previewFrameId = null
        interactionSequenceRef.current += 1
        gesture.interactionSequence = interactionSequenceRef.current
        renderSession.updateTransientLayerTransform(
          gesture.layerId,
          gesture.pendingTransform,
          gesture.interactionSequence,
          gesture.eventTimestamp,
        )
        renderSession.requestFrame('draft')
      }
      if (typeof requestAnimationFrame === 'function') {
        gesture.previewFrameId = requestAnimationFrame(publishGpuFrame)
      } else {
        publishGpuFrame()
      }
      return
    }
    if (gesture.directLayerFeedback && gesture.feedbackTarget) {
      const previewClientX = gesture.viewportRect.left
        + snappedOutputPoint[0] / outputGeometry.width * gesture.viewportRect.width
      const previewClientY = gesture.viewportRect.top
        + snappedOutputPoint[1] / outputGeometry.height * gesture.viewportRect.height
      // 常驻合成表面位于缩放容器之外，反馈位移必须保持屏幕像素；
      // 文档坐标缩放已经由 clientToOutput 负责，不能在这里再除一次 zoom。
      gesture.feedbackTarget.style.transform = changed
        ? `translate3d(${previewClientX - gesture.startClientPoint[0]}px, ${previewClientY - gesture.startClientPoint[1]}px, 0)`
        : ''
      return
    }
    if (gesture.previewFrameId !== null) return
    const publishPreview = (): void => {
      const current = gestureRef.current
      if (current !== gesture) return
      gesture.previewFrameId = null
      controller.setTransformPreview(gesture.previewId, gesture.layerId, gesture.pendingTransform)
      gesture.previewSet = true
    }
    if (typeof requestAnimationFrame === 'function') {
      gesture.previewFrameId = requestAnimationFrame(publishPreview)
    } else {
      publishPreview()
    }
  }

  const onPointerUpCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    release(true)
  }

  const onPointerCancelCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    if (gestureRef.current?.pointerId === event.pointerId) release(false)
  }

  return {
    unavailableReason,
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  }
}
