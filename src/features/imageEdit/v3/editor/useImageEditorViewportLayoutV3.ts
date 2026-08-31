import { useEffect, useMemo, useState, type RefObject } from 'react'

import type { ImageEditorViewportTransformV3 } from '../execution/viewportTilePlannerV3'
import type { ImageEditorViewportPanV3 } from './viewportNavigationV3'

const PREVIEW_PADDING_CSS_PIXELS = 48

interface ViewportSurfaceSizeV3 {
  width: number
  height: number
}

export interface ImageEditorViewportLayoutV3 {
  stageWidth: number
  stageHeight: number
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
}

function normalizedSurfaceSize(element: HTMLElement): ViewportSurfaceSizeV3 | null {
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return { width: rect.width, height: rect.height }
}

function keyNumber(value: number): string {
  return value.toFixed(4)
}

/** 将“适应窗口为 100%”的界面缩放换算为规划器需要的 CSS px / document px。 */
export function useImageEditorViewportLayoutV3(
  surfaceRef: RefObject<HTMLElement>,
  documentSize: { width: number; height: number },
  zoom: number,
  pan: ImageEditorViewportPanV3,
): ImageEditorViewportLayoutV3 | null {
  const [surfaceSize, setSurfaceSize] = useState<ViewportSurfaceSizeV3 | null>(null)

  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return
    const publish = (): void => {
      const next = normalizedSurfaceSize(element)
      setSurfaceSize((current) => (
        current?.width === next?.width && current?.height === next?.height ? current : next
      ))
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => observer.disconnect()
  }, [surfaceRef])

  return useMemo(() => {
    if (
      !surfaceSize
      || !Number.isSafeInteger(documentSize.width)
      || !Number.isSafeInteger(documentSize.height)
      || documentSize.width <= 0
      || documentSize.height <= 0
    ) return null
    const availableWidth = Math.max(1, surfaceSize.width - PREVIEW_PADDING_CSS_PIXELS)
    const availableHeight = Math.max(1, surfaceSize.height - PREVIEW_PADDING_CSS_PIXELS)
    const fitScale = Math.min(
      1,
      availableWidth / documentSize.width,
      availableHeight / documentSize.height,
    )
    const stageWidth = documentSize.width * fitScale
    const stageHeight = documentSize.height * fitScale
    const cssPixelsPerDocumentPixel = fitScale * zoom
    const documentX = (
      stageWidth * zoom / 2 - surfaceSize.width / 2 - pan.x
    ) / cssPixelsPerDocumentPixel
    const documentY = (
      stageHeight * zoom / 2 - surfaceSize.height / 2 - pan.y
    ) / cssPixelsPerDocumentPixel
    const viewport = {
      documentX,
      documentY,
      width: surfaceSize.width,
      height: surfaceSize.height,
      zoom: cssPixelsPerDocumentPixel,
      devicePixelRatio: typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1),
    }
    return {
      stageWidth,
      stageHeight,
      viewport,
      viewportKey: [
        keyNumber(documentX),
        keyNumber(documentY),
        keyNumber(viewport.width),
        keyNumber(viewport.height),
        keyNumber(viewport.zoom),
        keyNumber(viewport.devicePixelRatio),
      ].join(':'),
    }
  }, [documentSize.height, documentSize.width, pan.x, pan.y, surfaceSize, zoom])
}
