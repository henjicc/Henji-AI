import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  convertFloat32TileColorDomainV3,
  convertFloat32TileWorkingSpaceV3,
  createTileRegion,
  enumerateTilesForRect,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  decodeInterleavedRgbaSourceTileV3,
  decodeSrgbExtended,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditRect,
  type ImageEditRenderPlanNode,
  type ImageEditSparseMaskReferenceV3,
} from '@/core/imageEdit/v3'
import type { MarkItem } from '@/core/imageEdit/types'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorPreviewBrushTileV3 } from './previewProtocolV3'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('视口分块渲染已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

export function viewportCompositeSourceTileKeyV3(
  tile: Pick<ImageEditorV3SourceTile, 'resourceRef' | 'mip' | 'tileX' | 'tileY'>,
): string {
  return `${tile.resourceRef}:m${tile.mip}:x${tile.tileX}:y${tile.tileY}`
}

export function decodeImageEditorViewportSourceTileV3(
  tile: ImageEditorV3SourceTile,
  document: ImageEditDocumentV3,
): Float32PremultipliedRgbaTile {
  return decodeInterleavedRgbaSourceTileV3({
    width: tile.width,
    height: tile.height,
    rowStride: tile.rowStride,
    bitDepth: tile.bitDepth,
    sampleFormat: tile.sampleFormat,
    numericRange: tile.numericRange,
    byteOrder: tile.byteOrder,
    colorSpace: tile.colorSpace === 'scrgb' ? 'srgb' : tile.colorSpace,
    transferFunction: tile.transferFunction,
    referenceWhiteNits: document.color.hdrMetadata?.referenceWhiteNits
      ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
    alphaMode: tile.alphaMode,
    pixels: tile.pixels,
  }, document.color.workingSpace)
}

/**
 * 把 RenderPlan 逆向规划得到的任意矩形，从若干 512 源瓦片拼成连续区域。
 * 坐标始终是当前 mip 的全局像素坐标，缺失瓦片会明确失败而不是填黑。
 */
export function loadImageEditorViewportSourceRegionV3(
  tiles: ReadonlyMap<string, ImageEditorV3SourceTile>,
  resourceId: string,
  mip: number,
  region: ImageEditRect,
  document: ImageEditDocumentV3,
): Float32PremultipliedRgbaTile {
  const output = new Float32Array(region.width * region.height * 4)
  let template: Float32PremultipliedRgbaTile | null = null
  for (const coordinate of enumerateTilesForRect(document.geometry, mip, region)) {
    const source = tiles.get(`${resourceId}:m${mip}:x${coordinate.x}:y${coordinate.y}`)
    if (!source) throw new Error(`视口合成缺少图片资源瓦片：${resourceId}`)
    const expected = createTileRegion(document.geometry, {
      mip,
      x: coordinate.x,
      y: coordinate.y,
    }, source.halo)
    if (
      source.originX !== expected.sourceRect.x
      || source.originY !== expected.sourceRect.y
      || source.width !== expected.sourceRect.width
      || source.height !== expected.sourceRect.height
    ) throw new Error('视口合成源瓦片与计划区域不一致')
    const decoded = decodeImageEditorViewportSourceTileV3(source, document)
    template ??= decoded
    const left = Math.max(region.x, source.originX)
    const top = Math.max(region.y, source.originY)
    const right = Math.min(region.x + region.width, source.originX + source.width)
    const bottom = Math.min(region.y + region.height, source.originY + source.height)
    for (let y = top; y < bottom; y += 1) {
      const sourceOffset = ((y - source.originY) * source.width + left - source.originX) * 4
      const outputOffset = ((y - region.y) * region.width + left - region.x) * 4
      output.set(
        decoded.data.subarray(sourceOffset, sourceOffset + (right - left) * 4),
        outputOffset,
      )
    }
  }
  if (!template) throw new Error('视口合成源区域为空')
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    template.colorDomain,
    output,
    template.workingSpace,
    template.transferFunction,
    template.referenceWhiteNits,
  )
}

export function createTransparentImageEditorViewportRegionV3(
  region: ImageEditRect,
  document: ImageEditDocumentV3,
): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    'linear-light',
    new Float32Array(region.width * region.height * 4),
    document.color.workingSpace,
    document.color.transferFunction,
    document.color.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  )
}

function brushMap(
  tiles: readonly ImageEditorPreviewBrushTileV3[],
): ReadonlyMap<string, ImageEditorPreviewBrushTileV3> {
  const result = new Map<string, ImageEditorPreviewBrushTileV3>()
  for (const tile of tiles) {
    const expectedBytes = tile.width * tile.height
      * (tile.storage === 'rgba-float32' ? 4 : 1)
      * Float32Array.BYTES_PER_ELEMENT
    if (
      !(tile.bytes instanceof ArrayBuffer)
      || tile.bytes.byteLength !== expectedBytes
      || tile.width < 1
      || tile.height < 1
      || tile.width > 512
      || tile.height > 512
      || result.has(tile.resourceId)
    ) throw new Error(`视口画笔瓦片像素契约无效：${tile.resourceId}`)
    result.set(tile.resourceId, tile)
  }
  return result
}

function sampleBrushPixel(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  target: Float32Array,
  offset: number,
): void {
  const floorX = Math.floor(x)
  const floorY = Math.floor(y)
  const x0 = Math.max(0, Math.min(width - 1, floorX))
  const y0 = Math.max(0, Math.min(height - 1, floorY))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, x - floorX))
  const ty = Math.max(0, Math.min(1, y - floorY))
  for (let channel = 0; channel < 4; channel += 1) {
    const topLeft = source[(y0 * width + x0) * 4 + channel]
    const topRight = source[(y0 * width + x1) * 4 + channel]
    const bottomLeft = source[(y1 * width + x0) * 4 + channel]
    const bottomRight = source[(y1 * width + x1) * 4 + channel]
    const top = topLeft + (topRight - topLeft) * tx
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx
    target[offset + channel] = top + (bottom - top) * ty
  }
}

/** mip0 稀疏画笔是栅格源对应区域的 whole-tile replacement。 */
export function applyImageEditorViewportBrushTilesV3(
  node: ImageEditRenderPlanNode,
  base: Float32PremultipliedRgbaTile,
  region: ImageEditRect,
  mip: number,
  tiles: readonly ImageEditorPreviewBrushTileV3[],
  signal: AbortSignal,
): Float32PremultipliedRgbaTile {
  const references = isRecord(node.parameters.tiles) ? node.parameters.tiles : null
  if (!references || Object.keys(references).length === 0) return base
  const available = brushMap(tiles)
  const output = new Float32Array(base.data)
  const scale = 2 ** mip
  for (const [tileKey, resourceId] of Object.entries(references)) {
    const [mipValue, tileXValue, tileYValue, extra] = tileKey.split('/')
    const tileX = Number(tileXValue)
    const tileY = Number(tileYValue)
    if (extra !== undefined || Number(mipValue) !== 0 || tileX < 0 || tileY < 0) {
      throw new Error(`视口画笔瓦片键无效：${tileKey}`)
    }
    const left = tileX * 512 / scale
    const top = tileY * 512 / scale
    const tile = typeof resourceId === 'string' ? available.get(resourceId) : undefined
    const right = left + (tile?.width ?? 512) / scale
    const bottom = top + (tile?.height ?? 512) / scale
    const targetLeft = Math.max(region.x, Math.floor(left))
    const targetTop = Math.max(region.y, Math.floor(top))
    const targetRight = Math.min(region.x + region.width, Math.ceil(right))
    const targetBottom = Math.min(region.y + region.height, Math.ceil(bottom))
    if (targetRight <= targetLeft || targetBottom <= targetTop) continue
    if (!tile) throw new Error(`视口预览缺少画笔瓦片：${String(resourceId)}`)
    if (tile.storage !== 'rgba-float32') {
      throw new Error(`视口栅格图层引用了非 RGBA 瓦片：${String(resourceId)}`)
    }
    const source = new Float32Array(tile.bytes)
    for (let y = targetTop; y < targetBottom; y += 1) {
      throwIfAborted(signal)
      for (let x = targetLeft; x < targetRight; x += 1) {
        sampleBrushPixel(
          source,
          tile.width,
          tile.height,
          (x + 0.5) * scale - tileX * 512 - 0.5,
          (y + 0.5) * scale - tileY * 512 - 0.5,
          output,
          ((y - region.y) * region.width + x - region.x) * 4,
        )
      }
    }
  }
  return createFloat32PremultipliedRgbaTile(
    base.width,
    base.height,
    base.colorDomain,
    output,
    base.workingSpace,
    base.transferFunction,
    base.referenceWhiteNits,
  )
}

function sampleMaskPixel(
  source: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const floorX = Math.floor(x)
  const floorY = Math.floor(y)
  const x0 = Math.max(0, Math.min(width - 1, floorX))
  const y0 = Math.max(0, Math.min(height - 1, floorY))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, x - floorX))
  const ty = Math.max(0, Math.min(1, y - floorY))
  const top = source[y0 * width + x0]
    + (source[y0 * width + x1] - source[y0 * width + x0]) * tx
  const bottom = source[y1 * width + x0]
    + (source[y1 * width + x1] - source[y1 * width + x0]) * tx
  return top + (bottom - top) * ty
}

/** 缺失区域先填 defaultValue，命中的 mip0 蒙版瓦片再作 whole-tile replacement。 */
export function loadImageEditorViewportSparseMaskV3(
  reference: ImageEditSparseMaskReferenceV3,
  region: ImageEditRect,
  mip: number,
  tiles: readonly ImageEditorPreviewBrushTileV3[],
  signal: AbortSignal,
): Float32MaskTile {
  const available = brushMap(tiles)
  const output = new Float32Array(region.width * region.height)
  output.fill(reference.defaultValue)
  const scale = 2 ** mip
  for (const [tileKey, resourceId] of Object.entries(reference.tiles)) {
    const [mipValue, tileXValue, tileYValue, extra] = tileKey.split('/')
    const tileX = Number(tileXValue)
    const tileY = Number(tileYValue)
    if (extra !== undefined || Number(mipValue) !== 0 || tileX < 0 || tileY < 0) {
      throw new Error(`视口蒙版瓦片键无效：${tileKey}`)
    }
    const tile = available.get(resourceId)
    const left = tileX * 512 / scale
    const top = tileY * 512 / scale
    const right = left + (tile?.width ?? 512) / scale
    const bottom = top + (tile?.height ?? 512) / scale
    const targetLeft = Math.max(region.x, Math.floor(left))
    const targetTop = Math.max(region.y, Math.floor(top))
    const targetRight = Math.min(region.x + region.width, Math.ceil(right))
    const targetBottom = Math.min(region.y + region.height, Math.ceil(bottom))
    if (targetRight <= targetLeft || targetBottom <= targetTop) continue
    if (!tile) throw new Error(`视口预览缺少蒙版瓦片：${resourceId}`)
    if (tile.storage !== 'mask-float32') {
      throw new Error(`视口蒙版引用了非 mask-float32 瓦片：${resourceId}`)
    }
    const source = new Float32Array(tile.bytes)
    for (let y = targetTop; y < targetBottom; y += 1) {
      throwIfAborted(signal)
      for (let x = targetLeft; x < targetRight; x += 1) {
        output[(y - region.y) * region.width + x - region.x] = sampleMaskPixel(
          source,
          tile.width,
          tile.height,
          (x + 0.5) * scale - tileX * 512 - 0.5,
          (y + 0.5) * scale - tileY * 512 - 0.5,
        )
      }
    }
  }
  return createFloat32MaskTile(region.width, region.height, output)
}

function imageDataToViewportTile(imageData: ImageData): Float32PremultipliedRgbaTile {
  const data = new Float32Array(imageData.width * imageData.height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = imageData.data[offset + 3] / 255
    data[offset] = decodeSrgbExtended(imageData.data[offset] / 255) * alpha
    data[offset + 1] = decodeSrgbExtended(imageData.data[offset + 1] / 255) * alpha
    data[offset + 2] = decodeSrgbExtended(imageData.data[offset + 2] / 255) * alpha
    data[offset + 3] = alpha
  }
  return createFloat32PremultipliedRgbaTile(imageData.width, imageData.height, 'linear-light', data)
}

export function rasterizeImageEditorViewportAnnotationsV3(
  node: ImageEditRenderPlanNode,
  document: ImageEditDocumentV3,
  region: ImageEditRect,
  mip: number,
  signal: AbortSignal,
): Float32PremultipliedRgbaTile {
  throwIfAborted(signal)
  const canvas = new OffscreenCanvas(region.width, region.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建视口标注分块画布')
  context.save()
  context.translate(-region.x, -region.y)
  context.scale(1 / (2 ** mip), 1 / (2 ** mip))
  drawMarkItems(
    context,
    Array.isArray(node.parameters.annotations) ? node.parameters.annotations as MarkItem[] : [],
    document.geometry.width,
    document.geometry.height,
    { canvasKind: 'offscreen' },
  )
  context.restore()
  throwIfAborted(signal)
  return convertFloat32TileWorkingSpaceV3(
    imageDataToViewportTile(context.getImageData(0, 0, region.width, region.height)),
    document.color.workingSpace,
  )
}

export function imageEditorViewportTileToMaskV3(
  tile: Float32PremultipliedRgbaTile,
): Float32MaskTile {
  const perceptual = convertFloat32TileColorDomainV3(tile, 'perceptual-working')
  let usesAlpha = false
  for (let offset = 3; offset < perceptual.data.length; offset += 4) {
    if (perceptual.data[offset] < 1) { usesAlpha = true; break }
  }
  const data = new Float32Array(tile.width * tile.height)
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    const offset = pixel * 4
    const alpha = Math.min(1, Math.max(0, perceptual.data[offset + 3]))
    const inverseAlpha = alpha > 0 ? 1 / alpha : 0
    data[pixel] = usesAlpha ? alpha : Math.min(1, Math.max(0,
      perceptual.data[offset] * inverseAlpha * 0.2126
      + perceptual.data[offset + 1] * inverseAlpha * 0.7152
      + perceptual.data[offset + 2] * inverseAlpha * 0.0722,
    ))
  }
  return createFloat32MaskTile(tile.width, tile.height, data)
}

export function cropImageEditorViewportTileV3(
  tile: Float32PremultipliedRgbaTile,
  sourceRegion: ImageEditRect,
  outputRect: ImageEditRect,
): Float32PremultipliedRgbaTile {
  const data = new Float32Array(outputRect.width * outputRect.height * 4)
  const offsetX = outputRect.x - sourceRegion.x
  const offsetY = outputRect.y - sourceRegion.y
  for (let y = 0; y < outputRect.height; y += 1) {
    const start = ((offsetY + y) * tile.width + offsetX) * 4
    data.set(tile.data.subarray(start, start + outputRect.width * 4), y * outputRect.width * 4)
  }
  return createFloat32PremultipliedRgbaTile(
    outputRect.width,
    outputRect.height,
    tile.colorDomain,
    data,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  )
}
