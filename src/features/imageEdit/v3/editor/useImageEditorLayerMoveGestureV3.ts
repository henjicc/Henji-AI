import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'

import { useImageEditorSessionStoreV3 } from '../store'
import type { AnnotationOutputGeometryV3 } from './annotationGeometryV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import {
  isImageEditLayerTransformableV3,
  mapImageEditOutputPointToLayerParentV3,
  resolveImageEditLayerMoveUnavailableReasonV3,
  translateImageEditLayerTransformV3,
  type ImageEditLayerMoveUnavailableReasonV3,
} from './layerTransformV3'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorV3Controller } from './types'

interface ImageEditorLayerMoveGestureV3 {
  pointerId: number
  captureTarget: HTMLElement
  previewId: string
  layerId: string
  startParentPoint: readonly [number, number]
  startClientPoint: readonly [number, number]
  startTransform: ImageEditTransformV3
  pendingTransform: ImageEditTransformV3
  previewSet: boolean
  changed: boolean
  wholeFrameFeedback: boolean
}

const EMPTY_LAYER_IDS_V3: readonly string[] = []

export interface ImageEditorLayerMoveGestureHandlersV3 {
  unavailableReason: ImageEditLayerMoveUnavailableReasonV3 | null
  onPointerDownCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerMoveCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerUpCapture(event: ReactPointerEvent<HTMLElement>): void
  onPointerCancelCapture(event: ReactPointerEvent<HTMLElement>): void
}

/** move 只变换当前单选图层；annotation overlay 仍负责对象选择和二次编辑。 */
export function useImageEditorLayerMoveGestureV3(
  controller: ImageEditorV3Controller,
  activeTool: ImageEditorToolIdV3,
  viewportContentRef: RefObject<HTMLDivElement>,
  moveFeedbackRef: RefObject<HTMLDivElement>,
  outputGeometry: AnnotationOutputGeometryV3,
  viewportZoom: number,
): ImageEditorLayerMoveGestureHandlersV3 {
  const gestureRef = useRef<ImageEditorLayerMoveGestureV3 | null>(null)
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS_V3,
  )
  const selectedLocation = selectedLayerIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedLayerIds[0])
    : null
  const unavailableReason = resolveImageEditLayerMoveUnavailableReasonV3(selectedLocation)

  const clearWholeFrameFeedback = useCallback((): void => {
    const feedback = moveFeedbackRef.current
    if (!feedback) return
    feedback.style.transform = ''
    feedback.style.willChange = ''
  }, [moveFeedbackRef])

  const release = useCallback((commit: boolean): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    if (
      typeof gesture.captureTarget.hasPointerCapture === 'function'
      && gesture.captureTarget.hasPointerCapture(gesture.pointerId)
      && typeof gesture.captureTarget.releasePointerCapture === 'function'
    ) gesture.captureTarget.releasePointerCapture(gesture.pointerId)
    if (commit && gesture.changed) {
      try {
        controller.commitTransformPreview(
          gesture.previewId,
          gesture.layerId,
          gesture.pendingTransform,
        )
      } catch (error) {
        clearWholeFrameFeedback()
        throw error
      }
    } else if (gesture.previewSet) {
      controller.clearTransformPreview(gesture.previewId)
      clearWholeFrameFeedback()
    } else {
      clearWholeFrameFeedback()
    }
  }, [clearWholeFrameFeedback, controller])

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

  const clientToOutput = useCallback((
    clientX: number,
    clientY: number,
  ): readonly [number, number] | null => {
    const rect = viewportContentRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return [
      (clientX - rect.left) / rect.width * outputGeometry.width,
      (clientY - rect.top) / rect.height * outputGeometry.height,
    ]
  }, [outputGeometry.height, outputGeometry.width, viewportContentRef])

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
    const layerId = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null
    if (!layerId) return
    const location = findImageEditLayerLocationV3(controller.document.layers, layerId)
    const outputPoint = clientToOutput(event.clientX, event.clientY)
    if (!isImageEditLayerTransformableV3(location) || !outputPoint) return
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
      startTransform: [...location.layer.transform],
      pendingTransform: [...location.layer.transform],
      previewSet: false,
      changed: false,
      wholeFrameFeedback: location.parentId === null
        && location.layer.type === 'raster'
        && controller.document.layers.every((layer) => (
          layer.id === layerId
          || !layer.visible
          || layer.type === 'effect'
          || layer.type === 'adjustment'
        )),
    }
  }

  const onPointerMoveCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const location = findImageEditLayerLocationV3(controller.document.layers, gesture.layerId)
    const outputPoint = clientToOutput(event.clientX, event.clientY)
    if (!isImageEditLayerTransformableV3(location) || !outputPoint) {
      release(false)
      return
    }
    const point = mapImageEditOutputPointToLayerParentV3(controller.document, location, outputPoint)
    const deltaX = point[0] - gesture.startParentPoint[0]
    const deltaY = point[1] - gesture.startParentPoint[1]
    const changed = Math.hypot(deltaX, deltaY) >= 0.01
    if (!changed && !gesture.previewSet) return
    event.preventDefault()
    event.stopPropagation()
    gesture.previewSet = true
    gesture.changed = changed
    gesture.pendingTransform = changed
      ? translateImageEditLayerTransformV3(gesture.startTransform, deltaX, deltaY)
      : [...gesture.startTransform]
    if (gesture.wholeFrameFeedback && moveFeedbackRef.current) {
      const scale = Math.max(0.05, viewportZoom)
      moveFeedbackRef.current.style.willChange = 'transform'
      moveFeedbackRef.current.style.transform = changed
        ? `translate3d(${(event.clientX - gesture.startClientPoint[0]) / scale}px, ${(event.clientY - gesture.startClientPoint[1]) / scale}px, 0)`
        : ''
    }
    controller.setTransformPreview(gesture.previewId, gesture.layerId, gesture.pendingTransform)
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
