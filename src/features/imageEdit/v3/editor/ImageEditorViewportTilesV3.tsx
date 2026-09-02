import { useId, useLayoutEffect, useRef } from 'react'

import type { ImageEditorManagedViewportCompositeV3 } from '../execution/viewportCompositeClientV3'
import type { ImageEditorViewportLayoutV3 } from './useImageEditorViewportLayoutV3'

interface SurfacePixelsV3 {
  width: number
  height: number
}

function surfacePixels(layout: ImageEditorViewportLayoutV3): SurfacePixelsV3 {
  const dpr = layout.viewport.devicePixelRatio
  return {
    width: Math.max(1, Math.ceil(layout.viewport.width * dpr)),
    height: Math.max(1, Math.ceil(layout.viewport.height * dpr)),
  }
}

function resizePreservingLastFrame(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  if (canvas.width === width && canvas.height === height) return
  const previous = document.createElement('canvas')
  previous.width = canvas.width
  previous.height = canvas.height
  previous.getContext('2d')?.drawImage(canvas, 0, 0)
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context && previous.width > 0 && previous.height > 0) {
    context.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, width, height)
  }
}

function drawAtomicFrame(
  canvas: HTMLCanvasElement,
  safetyCanvas: HTMLCanvasElement,
  result: ImageEditorManagedViewportCompositeV3,
  layout: ImageEditorViewportLayoutV3,
): void {
  const pixels = surfacePixels(layout)
  resizePreservingLastFrame(canvas, pixels.width, pixels.height)
  resizePreservingLastFrame(safetyCanvas, pixels.width, pixels.height)
  const staging = document.createElement('canvas')
  staging.width = pixels.width
  staging.height = pixels.height
  const stagingContext = staging.getContext('2d')
  const frontContext = canvas.getContext('2d')
  const safetyContext = safetyCanvas.getContext('2d')
  if (!stagingContext || !frontContext || !safetyContext) {
    throw new Error('无法创建图片编辑器常驻显示表面')
  }
  const { viewport } = layout
  const mipScale = 2 ** result.mip
  const screenScale = viewport.zoom * viewport.devicePixelRatio
  stagingContext.imageSmoothingEnabled = true
  stagingContext.imageSmoothingQuality = result.mip <= 1 ? 'high' : 'medium'
  for (const tile of result.tiles) {
    const documentX = tile.outputRect.x * mipScale
    const documentY = tile.outputRect.y * mipScale
    const documentRight = Math.min(
      result.documentWidth,
      (tile.outputRect.x + tile.outputRect.width) * mipScale,
    )
    const documentBottom = Math.min(
      result.documentHeight,
      (tile.outputRect.y + tile.outputRect.height) * mipScale,
    )
    stagingContext.drawImage(
      tile.bitmap,
      (documentX - viewport.documentX) * screenScale,
      (documentY - viewport.documentY) * screenScale,
      (documentRight - documentX) * screenScale,
      (documentBottom - documentY) * screenScale,
    )
  }
  frontContext.globalCompositeOperation = 'copy'
  frontContext.drawImage(staging, 0, 0)
  frontContext.globalCompositeOperation = 'source-over'
  safetyContext.globalCompositeOperation = 'copy'
  safetyContext.drawImage(staging, 0, 0)
  safetyContext.globalCompositeOperation = 'source-over'
}

/**
 * React 只挂载两张固定表面。所有瓦片先进入 staging，再原子复制到前表面；
 * 下层 Canvas2D 始终保留最后一张完整画面，失败期间不会显露空 canvas。
 */
export function ImageEditorViewportTilesV3({
  result,
  layout,
  expectedGeometryHash,
  label,
}: {
  result: ImageEditorManagedViewportCompositeV3 | null
  layout: ImageEditorViewportLayoutV3 | null
  expectedGeometryHash: string
  label: string
}): JSX.Element {
  const surfaceId = useId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const safetyRef = useRef<HTMLCanvasElement | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const safetyCanvas = safetyRef.current
    if (!canvas || !safetyCanvas || !result || !layout) return
    if (result.geometryHash !== expectedGeometryHash) return
    drawAtomicFrame(canvas, safetyCanvas, result, layout)
    canvas.dataset.renderGeneration = String(result.renderGeneration)
    canvas.dataset.cameraSequence = String(result.cameraSequence)
    canvas.dataset.geometryHash = result.geometryHash
  }, [expectedGeometryHash, layout, result])

  return (
    <div
      role="img"
      aria-label={label}
      data-presentation-surface={surfaceId}
      data-viewport-mip={result?.mip}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={safetyRef}
        data-presentation-safety-surface
        className="absolute inset-0 block h-full w-full"
      />
      <canvas
        ref={canvasRef}
        data-presentation-front-surface
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  )
}
