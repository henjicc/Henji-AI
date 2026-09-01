import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ImageEditCropRectV3, ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { CropOverlayBox } from '@/features/imageMark/editor/CropOverlayBox'

import type { AnnotationOutputGeometryV3 } from './annotationGeometryV3'
import type { ImageEditorV3Controller } from './types'
import {
  useImageEditorSessionStoreV3,
  type ImageEditorCropAspectRatioV3,
} from '../store/imageEditorSessionStoreV3'

function resolveCropRatioV3(
  value: ImageEditorCropAspectRatioV3,
  width: number,
  height: number,
): number | null {
  if (value === 'free') return null
  if (value === 'original') return width / Math.max(1, height)
  const [ratioWidth, ratioHeight] = value.split(':').map(Number)
  return ratioWidth / ratioHeight
}

function normalizeCropV3(
  crop: ImageEditCropRectV3,
  width: number,
  height: number,
): ImageEditCropRectV3 {
  const normalizedWidth = Math.max(1, Math.min(width, Math.round(crop.width)))
  const normalizedHeight = Math.max(1, Math.min(height, Math.round(crop.height)))
  return {
    x: Math.max(0, Math.min(width - normalizedWidth, Math.round(crop.x))),
    y: Math.max(0, Math.min(height - normalizedHeight, Math.round(crop.y))),
    width: normalizedWidth,
    height: normalizedHeight,
  }
}

function fitCropToRatioV3(
  crop: ImageEditCropRectV3,
  ratio: number,
  width: number,
  height: number,
): ImageEditCropRectV3 {
  let nextWidth = crop.width
  let nextHeight = nextWidth / ratio
  if (nextHeight > crop.height) {
    nextHeight = crop.height
    nextWidth = nextHeight * ratio
  }
  return normalizeCropV3({
    x: crop.x + (crop.width - nextWidth) / 2,
    y: crop.y + (crop.height - nextHeight) / 2,
    width: nextWidth,
    height: nextHeight,
  }, width, height)
}

export function ImageEditorCropOverlayV3({
  controller,
  projectedDocument,
  geometry,
  stageWidth,
  stageHeight,
}: {
  controller: ImageEditorV3Controller
  projectedDocument: ImageEditDocumentV3
  geometry: AnnotationOutputGeometryV3
  stageWidth: number
  stageHeight: number
}): JSX.Element {
  const previewId = `${controller.sessionId}:output-geometry`
  const cropAspectRatio = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings.cropAspectRatio ?? 'free',
  )
  const ratio = resolveCropRatioV3(cropAspectRatio, geometry.width, geometry.height)
  const fullCrop = useMemo(() => ({
    x: 0,
    y: 0,
    width: geometry.width,
    height: geometry.height,
  }), [geometry.height, geometry.width])
  const [crop, setCrop] = useState<ImageEditCropRectV3>(
    projectedDocument.geometry.crop ?? fullCrop,
  )
  const cropRef = useRef(crop)
  cropRef.current = crop

  useEffect(() => {
    const next = projectedDocument.geometry.crop ?? fullCrop
    setCrop(next)
    cropRef.current = next
  }, [
    geometry.height,
    geometry.width,
    fullCrop,
    projectedDocument.geometry.crop,
  ])

  const update = useCallback((next: ImageEditCropRectV3): void => {
    const normalized = normalizeCropV3(next, geometry.width, geometry.height)
    cropRef.current = normalized
    setCrop(normalized)
    controller.setOutputGeometryPreview(
      previewId,
      projectedDocument.geometry.orientation,
      normalized,
    )
  }, [controller, geometry.height, geometry.width, previewId, projectedDocument.geometry.orientation])

  const previousRatioRef = useRef<ImageEditorCropAspectRatioV3>(cropAspectRatio)
  useEffect(() => {
    if (previousRatioRef.current === cropAspectRatio) return
    previousRatioRef.current = cropAspectRatio
    if (!ratio) return
    update(fitCropToRatioV3(cropRef.current, ratio, geometry.width, geometry.height))
  }, [cropAspectRatio, geometry.height, geometry.width, ratio, update])

  return (
    <div data-crop-overlay className="absolute inset-0 z-raised">
      <CropOverlayBox
        displayWidth={stageWidth}
        displayHeight={stageHeight}
        scale={stageWidth / Math.max(1, geometry.width)}
        crop={crop}
        imageWidth={geometry.width}
        imageHeight={geometry.height}
        ratio={ratio}
        onChange={update}
        onCommit={() => undefined}
      />
    </div>
  )
}
