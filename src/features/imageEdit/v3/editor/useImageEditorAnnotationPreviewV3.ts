import { useCallback, useEffect, useRef } from 'react'

import type { MarkItem } from '@/core/imageEdit/types'
import { useImageEditorInteractionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'

const PREVIEW_COMMIT_DELAY_MS = 180

/** 标注滑杆只更新前台矢量层；松手或短暂停顿后才写入一个历史命令。 */
export function useImageEditorAnnotationPreviewV3(
  controller: ImageEditorV3Controller,
  layerId: string | null,
  annotation: MarkItem | null,
) {
  const preview = useImageEditorInteractionStoreV3((state) => (
    state.annotationPreviewBySession[controller.sessionId]
  ))
  const publish = useImageEditorInteractionStoreV3((state) => state.previewAnnotation)
  const clear = useImageEditorInteractionStoreV3((state) => state.clearAnnotationPreview)
  const pendingRef = useRef<MarkItem | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayed = annotation && preview?.layerId === layerId && preview.annotationId === annotation.id
    ? preview.annotation
    : annotation

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const commit = useCallback(() => {
    cancelTimer()
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending || !layerId || !annotation) return
    controller.updateAnnotation(layerId, annotation.id, pending)
    clear(controller.sessionId)
  }, [annotation, cancelTimer, clear, controller, layerId])

  const update = useCallback((next: MarkItem) => {
    if (!layerId || !annotation) return
    pendingRef.current = next
    publish(controller.sessionId, {
      layerId,
      annotationId: annotation.id,
      annotation: next,
    })
    cancelTimer()
    timerRef.current = setTimeout(commit, PREVIEW_COMMIT_DELAY_MS)
  }, [annotation, cancelTimer, commit, controller.sessionId, layerId, publish])

  const cancel = useCallback(() => {
    cancelTimer()
    pendingRef.current = null
    clear(controller.sessionId)
  }, [cancelTimer, clear, controller.sessionId])

  useEffect(() => () => cancel(), [annotation?.id, cancel, layerId])

  return { annotation: displayed, update, commit, cancel }
}
