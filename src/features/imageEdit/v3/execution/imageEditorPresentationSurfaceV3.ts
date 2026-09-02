import {
  imageEditOutputSizeV3,
  mapImageEditOutputPixelToSourceV3,
  mapImageEditSourcePixelToOutputV3,
  resolveImageEditOutputGeometryV3,
  type ImageEditRect,
} from '@/core/imageEdit/v3'
import type { ImageEditCanvasGeometryV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'

export interface ImageEditorPresentationSurfaceElementsV3 {
  surfaceId: string
  front: HTMLCanvasElement
  safety: HTMLCanvasElement
}

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
  if (previous.width <= 0 || previous.height <= 0) return
  canvas.getContext('2d')?.drawImage(
    previous,
    0,
    0,
    previous.width,
    previous.height,
    0,
    0,
    width,
    height,
  )
}

function intersectionArea(left: ImageEditRect, right: ImageEditRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  return width * height
}

function visibleDocumentRect(
  result: ImageEditorManagedViewportCompositeV3,
  layout: ImageEditorViewportLayoutV3,
): ImageEditRect {
  const viewport = layout.viewport
  const x = Math.max(0, viewport.documentX)
  const y = Math.max(0, viewport.documentY)
  const right = Math.min(result.documentWidth, viewport.documentX + viewport.width / viewport.zoom)
  const bottom = Math.min(result.documentHeight, viewport.documentY + viewport.height / viewport.zoom)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

export function imageEditorViewportResultCoverageV3(
  result: ImageEditorManagedViewportCompositeV3 | null,
  layout: ImageEditorViewportLayoutV3,
): number {
  if (!result) return 0
  if (result.coverage === 'document') return 1
  const visible = visibleDocumentRect(result, layout)
  const visibleArea = visible.width * visible.height
  if (visibleArea === 0) return 1
  const scale = 2 ** result.mip
  const covered = result.tiles.reduce((total, tile) => total + intersectionArea(visible, {
    x: tile.outputRect.x * scale,
    y: tile.outputRect.y * scale,
    width: tile.outputRect.width * scale,
    height: tile.outputRect.height * scale,
  }), 0)
  return Math.max(0, Math.min(1, covered / visibleArea))
}

function drawResult(
  context: CanvasRenderingContext2D,
  result: ImageEditorManagedViewportCompositeV3,
  layout: ImageEditorViewportLayoutV3,
  currentGeometry: ImageEditCanvasGeometryV3,
): void {
  const viewport = layout.viewport
  const mipScale = 2 ** result.mip
  const screenScale = viewport.zoom * viewport.devicePixelRatio
  const from = resolveImageEditOutputGeometryV3(result.geometry)
  const to = resolveImageEditOutputGeometryV3(currentGeometry)
  const map = (x: number, y: number): readonly [number, number] => {
    const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(x, y, from)
    return mapImageEditSourcePixelToOutputV3(sourceX, sourceY, to)
  }
  const origin = map(0, 0)
  const unitX = map(1, 0)
  const unitY = map(0, 1)
  const affine = {
    a: unitX[0] - origin[0],
    b: unitX[1] - origin[1],
    c: unitY[0] - origin[0],
    d: unitY[1] - origin[1],
    e: origin[0],
    f: origin[1],
  }
  const outputSize = imageEditOutputSizeV3(currentGeometry)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = result.mip <= 1 ? 'high' : 'medium'
  context.save()
  context.beginPath()
  context.rect(
    -viewport.documentX * screenScale,
    -viewport.documentY * screenScale,
    outputSize.width * screenScale,
    outputSize.height * screenScale,
  )
  context.clip()
  context.setTransform(
    affine.a * screenScale,
    affine.b * screenScale,
    affine.c * screenScale,
    affine.d * screenScale,
    (affine.e - viewport.documentX) * screenScale,
    (affine.f - viewport.documentY) * screenScale,
  )
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
    context.drawImage(
      tile.bitmap,
      documentX,
      documentY,
      documentRight - documentX,
      documentBottom - documentY,
    )
  }
  context.restore()
}

/** 固定双表面的 Canvas2D 合成器；前表面只接收完整 staging 帧。 */
export class ImageEditorPresentationSurfaceV3 {
  private elements: ImageEditorPresentationSurfaceElementsV3 | null = null
  private staging: HTMLCanvasElement | null = null

  attach(elements: ImageEditorPresentationSurfaceElementsV3): void {
    this.elements = elements
    this.staging ??= document.createElement('canvas')
  }

  detach(elements: ImageEditorPresentationSurfaceElementsV3): void {
    if (this.elements?.front === elements.front && this.elements.safety === elements.safety) {
      this.elements = null
    }
  }

  present(
    fallback: ImageEditorManagedViewportCompositeV3,
    target: ImageEditorManagedViewportCompositeV3 | null,
    layout: ImageEditorViewportLayoutV3,
    cameraSequence: number,
    currentGeometry: ImageEditCanvasGeometryV3,
    currentGeometryHash: string,
  ): { coverage: number; targetMipCoverage: number } | null {
    const elements = this.elements
    const staging = this.staging
    if (!elements || !staging) return null
    const pixels = surfacePixels(layout)
    resizePreservingLastFrame(elements.front, pixels.width, pixels.height)
    resizePreservingLastFrame(elements.safety, pixels.width, pixels.height)
    if (staging.width !== pixels.width) staging.width = pixels.width
    if (staging.height !== pixels.height) staging.height = pixels.height
    const stagingContext = staging.getContext('2d')
    const frontContext = elements.front.getContext('2d')
    const safetyContext = elements.safety.getContext('2d')
    if (!stagingContext || !frontContext || !safetyContext) {
      throw new Error('无法创建图片编辑器常驻显示表面')
    }
    stagingContext.clearRect(0, 0, pixels.width, pixels.height)
    drawResult(stagingContext, fallback, layout, currentGeometry)
    if (target && target.renderGeneration === fallback.renderGeneration) {
      drawResult(stagingContext, target, layout, currentGeometry)
    }
    frontContext.globalCompositeOperation = 'copy'
    frontContext.drawImage(staging, 0, 0)
    frontContext.globalCompositeOperation = 'source-over'
    safetyContext.globalCompositeOperation = 'copy'
    safetyContext.drawImage(staging, 0, 0)
    safetyContext.globalCompositeOperation = 'source-over'
    elements.front.dataset.renderGeneration = String(fallback.renderGeneration)
    elements.front.dataset.cameraSequence = String(cameraSequence)
    elements.front.dataset.geometryHash = currentGeometryHash
    const targetMipCoverage = imageEditorViewportResultCoverageV3(target, layout)
    return { coverage: 1, targetMipCoverage }
  }
}
