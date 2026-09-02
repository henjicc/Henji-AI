import {
  imageEditOutputSizeV3,
  mapImageEditOutputPixelToSourceV3,
  mapImageEditSourcePixelToOutputV3,
  resolveImageEditOutputGeometryV3,
  type ImageEditRect,
} from '@/core/imageEdit/v3'
import type { ImageEditCanvasGeometryV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import type { ImageEditorViewportCompositeBitmapTileV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import { ImageEditorPresentationAtlasV3 } from './imageEditorPresentationAtlasV3'

export interface ImageEditorPresentationSurfaceElementsV3 {
  surfaceId: string
  front: HTMLCanvasElement
  safety: HTMLCanvasElement
}

interface SurfacePixelsV3 {
  width: number
  height: number
}

interface ImageEditorPresentationFrameV3 {
  canvas: HTMLCanvasElement
  bounds: ImageEditRect
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
  buffer: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  if (canvas.width === width && canvas.height === height) return
  buffer.width = canvas.width
  buffer.height = canvas.height
  buffer.getContext('2d')?.drawImage(canvas, 0, 0)
  canvas.width = width
  canvas.height = height
  if (buffer.width <= 0 || buffer.height <= 0) return
  canvas.getContext('2d')?.drawImage(
    buffer,
    0,
    0,
    buffer.width,
    buffer.height,
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
  result: Pick<ImageEditorManagedViewportCompositeV3, 'documentWidth' | 'documentHeight'>,
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
  frame: ImageEditorPresentationFrameV3 | null,
  result: ImageEditorManagedViewportCompositeV3,
  layout: ImageEditorViewportLayoutV3,
  currentGeometry: ImageEditCanvasGeometryV3,
  replace = false,
): void {
  if (!frame) return
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
  const documentX = frame.bounds.x * mipScale
  const documentY = frame.bounds.y * mipScale
  const documentRight = Math.min(
    result.documentWidth,
    (frame.bounds.x + frame.bounds.width) * mipScale,
  )
  const documentBottom = Math.min(
    result.documentHeight,
    (frame.bounds.y + frame.bounds.height) * mipScale,
  )
  if (replace) {
    context.save()
    context.beginPath()
    context.rect(documentX, documentY, documentRight - documentX, documentBottom - documentY)
    context.clip()
    context.globalCompositeOperation = 'copy'
  }
  context.drawImage(
    frame.canvas,
    0,
    0,
    frame.canvas.width,
    frame.canvas.height,
    documentX,
    documentY,
    documentRight - documentX,
    documentBottom - documentY,
  )
  if (replace) context.restore()
  context.restore()
}

export function imageEditorViewportTileCoverageContributionV3(
  tile: ImageEditorViewportCompositeBitmapTileV3,
  mip: number,
  documentSize: { width: number; height: number },
  layout: ImageEditorViewportLayoutV3,
): number {
  const visible = visibleDocumentRect({
    documentWidth: documentSize.width,
    documentHeight: documentSize.height,
  }, layout)
  const visibleArea = visible.width * visible.height
  if (visibleArea === 0) return 1
  const scale = 2 ** mip
  return intersectionArea(visible, {
    x: tile.outputRect.x * scale,
    y: tile.outputRect.y * scale,
    width: tile.outputRect.width * scale,
    height: tile.outputRect.height * scale,
  }) / visibleArea
}

/** 固定双表面的 Canvas2D 合成器；前表面只接收完整 staging 帧。 */
export class ImageEditorPresentationSurfaceV3 {
  private readonly atlas = new ImageEditorPresentationAtlasV3()
  private readonly frames = new Map<
    ImageEditorManagedViewportCompositeV3,
    ImageEditorPresentationFrameV3
  >()
  private elements: ImageEditorPresentationSurfaceElementsV3 | null = null
  private staging: HTMLCanvasElement | null = null
  private resizeBuffer: HTMLCanvasElement | null = null
  private nextResultId = 0

  attach(elements: ImageEditorPresentationSurfaceElementsV3): void {
    this.elements = elements
    this.staging ??= document.createElement('canvas')
    this.resizeBuffer ??= document.createElement('canvas')
  }

  detach(elements: ImageEditorPresentationSurfaceElementsV3): void {
    if (this.elements?.front === elements.front && this.elements.safety === elements.safety) {
      this.elements = null
    }
  }

  present(
    fallback: ImageEditorManagedViewportCompositeV3 | null,
    target: ImageEditorManagedViewportCompositeV3 | null,
    layout: ImageEditorViewportLayoutV3,
    cameraSequence: number,
    currentGeometry: ImageEditCanvasGeometryV3,
    currentGeometryHash: string,
  ): { coverage: number; targetMipCoverage: number } | null {
    const elements = this.elements
    const staging = this.staging
    const resizeBuffer = this.resizeBuffer
    if (!elements || !staging || !resizeBuffer) return null
    const pixels = surfacePixels(layout)
    resizePreservingLastFrame(elements.front, resizeBuffer, pixels.width, pixels.height)
    resizePreservingLastFrame(elements.safety, resizeBuffer, pixels.width, pixels.height)
    if (staging.width !== pixels.width) staging.width = pixels.width
    if (staging.height !== pixels.height) staging.height = pixels.height
    const stagingContext = staging.getContext('2d')
    const frontContext = elements.front.getContext('2d')
    const safetyContext = elements.safety.getContext('2d')
    if (!stagingContext || !frontContext || !safetyContext) {
      throw new Error('无法创建图片编辑器常驻显示表面')
    }
    const targetMipCoverage = imageEditorViewportResultCoverageV3(target, layout)
    const presentableTarget = target
      && target.viewportKey === layout.viewportKey
      && target.cameraSequence === cameraSequence
      && targetMipCoverage >= 0.999_999
        ? target
        : null
    const base = fallback ?? presentableTarget
    if (!base) return null
    const overlay = presentableTarget && presentableTarget !== base ? presentableTarget : null
    this.retainFrames(overlay ? [base, overlay] : [base])
    const baseFrame = this.frameFor(base)
    const targetFrame = overlay ? this.frameFor(overlay) : null
    stagingContext.clearRect(0, 0, pixels.width, pixels.height)
    drawResult(stagingContext, baseFrame, base, layout, currentGeometry, true)
    if (overlay) {
      drawResult(stagingContext, targetFrame, overlay, layout, currentGeometry, true)
    }
    frontContext.globalCompositeOperation = 'copy'
    frontContext.drawImage(staging, 0, 0)
    frontContext.globalCompositeOperation = 'source-over'
    safetyContext.globalCompositeOperation = 'copy'
    safetyContext.drawImage(staging, 0, 0)
    safetyContext.globalCompositeOperation = 'source-over'
    elements.front.dataset.renderGeneration = String(
      overlay?.renderGeneration ?? base.renderGeneration,
    )
    elements.front.dataset.cameraSequence = String(cameraSequence)
    elements.front.dataset.geometryHash = currentGeometryHash
    return {
      coverage: 1,
      targetMipCoverage,
    }
  }

  dispose(): void {
    this.elements = null
    this.staging = null
    this.resizeBuffer = null
    this.retainFrames([])
    this.atlas.dispose()
  }

  private frameFor(
    result: ImageEditorManagedViewportCompositeV3,
  ): ImageEditorPresentationFrameV3 | null {
    const cached = this.frames.get(result)
    if (cached) return cached
    if (result.tiles.length === 0) return null
    const left = Math.min(...result.tiles.map((tile) => tile.outputRect.x))
    const top = Math.min(...result.tiles.map((tile) => tile.outputRect.y))
    const right = Math.max(...result.tiles.map((tile) => tile.outputRect.x + tile.outputRect.width))
    const bottom = Math.max(...result.tiles.map((tile) => tile.outputRect.y + tile.outputRect.height))
    const bounds = { x: left, y: top, width: right - left, height: bottom - top }
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)
      || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('图片编辑 Presentation 连续帧范围无效')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bounds.width
    canvas.height = bounds.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片编辑 Presentation 连续帧')
    const resultId = this.nextResultId += 1
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (const tile of result.tiles) {
      const atlasRegion = this.atlas.store([
        resultId,
        result.renderGeneration,
        result.geometryHash,
        result.mip,
        tile.outputRect.x,
        tile.outputRect.y,
        tile.outputRect.width,
        tile.outputRect.height,
      ].join(':'), tile.bitmap)
      context.drawImage(
        atlasRegion.source,
        atlasRegion.sourceX,
        atlasRegion.sourceY,
        atlasRegion.width,
        atlasRegion.height,
        tile.outputRect.x - bounds.x,
        tile.outputRect.y - bounds.y,
        tile.outputRect.width,
        tile.outputRect.height,
      )
    }
    const frame = { canvas, bounds }
    this.frames.set(result, frame)
    return frame
  }

  private retainFrames(results: readonly ImageEditorManagedViewportCompositeV3[]): void {
    const retained = new Set(results)
    for (const [result, frame] of this.frames) {
      if (retained.has(result)) continue
      frame.canvas.width = 1
      frame.canvas.height = 1
      this.frames.delete(result)
    }
  }
}
