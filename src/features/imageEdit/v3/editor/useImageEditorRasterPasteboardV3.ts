import { useCallback, useMemo, useRef, useState } from 'react'

import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorViewportDocumentFrameV3 } from './useImageEditorViewportLayoutV3'
import {
  imageEditorRasterPasteboardTransformV3,
  resolveImageEditorRasterPasteboardLayerV3,
} from './rasterPasteboardV3'

export function useImageEditorRasterPasteboardV3(
  document: ImageEditDocumentV3,
  sourceImageUrl: string,
  documentWidth: number,
  enabled: boolean,
) {
  const feedbackRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const layer = useMemo(
    () => enabled ? resolveImageEditorRasterPasteboardLayerV3(document) : null,
    [document, enabled],
  )
  const sourceIdentity = layer?.source.kind === 'resource'
    ? `${layer.source.resourceId}:${sourceImageUrl}`
    : null
  const [readySourceIdentity, setReadySourceIdentity] = useState<string | null>(null)
  const ready = sourceIdentity !== null && readySourceIdentity === sourceIdentity
  const markReady = useCallback((): void => {
    if (sourceIdentity) setReadySourceIdentity(sourceIdentity)
  }, [sourceIdentity])
  const updateFrame = useCallback((frame: ImageEditorViewportDocumentFrameV3): void => {
    const source = feedbackRef.current
    if (source) {
      source.style.left = `${frame.left}px`
      source.style.top = `${frame.top}px`
      source.style.width = `${frame.width}px`
      source.style.height = `${frame.height}px`
    }
    if (imageRef.current && layer) {
      imageRef.current.style.transform = imageEditorRasterPasteboardTransformV3(
        layer.transform,
        frame.width,
        documentWidth,
      )
    }
  }, [documentWidth, layer])

  return {
    feedbackRef,
    imageRef,
    layer,
    sourceIdentity,
    ready,
    markReady,
    updateFrame,
  }
}
