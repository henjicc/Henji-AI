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
  viewportRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  startTransform: ImageEditTransformV3
  pendingTransform: ImageEditTransformV3
  previewFrameId: number | null
  previewSet: boolean
  interacted: boolean
  changed: boolean
  directLayerFeedback: boolean
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
  directLayerFeedbackAvailable: boolean,
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
  }, [moveFeedbackRef])

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
    if (
      typeof gesture.captureTarget.hasPointerCapture === 'function'
      && gesture.captureTarget.hasPointerCapture(gesture.pointerId)
      && typeof gesture.captureTarget.releasePointerCapture === 'function'
    ) gesture.captureTarget.releasePointerCapture(gesture.pointerId)
    if (commit && gesture.changed) {
      try {
        if (gesture.directLayerFeedback) {
          controller.updateLayerCommon(gesture.layerId, { transform: gesture.pendingTransform })
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
        clearWholeFrameFeedback()
        throw error
      }
    } else if (gesture.previewSet) {
      controller.clearTransformPreview(gesture.previewId)
      clearWholeFrameFeedback()
    } else {
      clearWholeFrameFeedback()
    }
  }, [cancelScheduledPreview, clearWholeFrameFeedback, controller])

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
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    clientX: number,
    clientY: number,
    clampOutside = false,
  ): readonly [number, number] | null => {
    if (rect.width <= 0 || rect.height <= 0) return null
    const outside = (
      clientX < rect.left
      || clientX > rect.left + rect.width
      || clientY < rect.top
      || clientY > rect.top + rect.height
    )
    if (outside && !clampOutside) return null
    const x = Math.min(rect.left + rect.width, Math.max(rect.left, clientX))
    const y = Math.min(rect.top + rect.height, Math.max(rect.top, clientY))
    return [
      (x - rect.left) / rect.width * outputGeometry.width,
      (y - rect.top) / rect.height * outputGeometry.height,
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
    if (!viewportRect) return
    const outputPoint = clientToOutput(viewportRect, event.clientX, event.clientY)
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
      viewportRect: {
        left: viewportRect.left,
        top: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      },
      startTransform: [...location.layer.transform],
      pendingTransform: [...location.layer.transform],
      previewFrameId: null,
      previewSet: false,
      interacted: false,
      changed: false,
      directLayerFeedback: directLayerFeedbackAvailable
        && moveFeedbackRef.current !== null
        && location.parentId === null
        && location.layer.type === 'raster'
        && controller.document.geometry.crop === null
        && controller.document.geometry.orientation.rotate === 0
        && !controller.document.geometry.orientation.mirrored
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
    const point = mapImageEditOutputPointToLayerParentV3(controller.document, location, outputPoint)
    const deltaX = point[0] - gesture.startParentPoint[0]
    const deltaY = point[1] - gesture.startParentPoint[1]
    const changed = Math.hypot(deltaX, deltaY) >= 0.01
    if (!changed && !gesture.interacted) return
    event.preventDefault()
    event.stopPropagation()
    gesture.interacted = true
    gesture.changed = changed
    gesture.pendingTransform = changed
      ? translateImageEditLayerTransformV3(gesture.startTransform, deltaX, deltaY)
      : [...gesture.startTransform]
    if (gesture.directLayerFeedback && moveFeedbackRef.current) {
      const previewClientX = gesture.viewportRect.left
        + outputPoint[0] / outputGeometry.width * gesture.viewportRect.width
      const previewClientY = gesture.viewportRect.top
        + outputPoint[1] / outputGeometry.height * gesture.viewportRect.height
      // 常驻合成表面位于缩放容器之外，反馈位移必须保持屏幕像素；
      // 文档坐标缩放已经由 clientToOutput 负责，不能在这里再除一次 zoom。
      moveFeedbackRef.current.style.transform = changed
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
