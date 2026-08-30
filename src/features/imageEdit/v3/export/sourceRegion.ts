import {
  convertFloat32TileColorDomainV3,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  decodeInterleavedRgbaSourceTileV3,
  enumerateTilesForRect,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
  type ImageEditTransferFunctionV3,
  type ImageEditWorkingSpaceV3,
} from '@/core/imageEdit/v3'
import {
  createImageEditorV3RequestId,
  readImageEditorV3SourceTile,
} from '@/commands/imageEditorV3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type {
  ImageEditorV3ExportRenderDependencies,
  ImageEditorV3ExportRenderRegion,
  ImageEditorV3ExportSourceTileRequest,
} from './contracts'

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('图片分块导出已取消')
  error.name = 'AbortError'
  throw error
}

function defaultReadSourceTile(
  request: ImageEditorV3ExportSourceTileRequest,
  signal: AbortSignal,
): Promise<ImageEditorV3SourceTile> {
  return readImageEditorV3SourceTile({
    requestId: createImageEditorV3RequestId('export-source-tile'),
    ...request,
  }, signal)
}

function sourceWorkingSpace(): 'srgb' {
  // scRGB 与 sRGB 共用 D65/sRGB 原色，只是传递函数和数值范围不同。
  return 'srgb'
}

function decodeSourceTile(
  tile: ImageEditorV3SourceTile,
  targetWorkingSpace: ImageEditWorkingSpaceV3,
): Float32PremultipliedRgbaTile {
  return decodeInterleavedRgbaSourceTileV3({
    width: tile.width,
    height: tile.height,
    rowStride: tile.rowStride,
    bitDepth: tile.bitDepth,
    sampleFormat: tile.sampleFormat,
    numericRange: tile.numericRange,
    byteOrder: tile.byteOrder,
    colorSpace: sourceWorkingSpace(),
    transferFunction: tile.transferFunction,
    alphaMode: tile.alphaMode,
    pixels: tile.pixels,
  }, targetWorkingSpace)
}

function copyIntersection(
  source: Float32PremultipliedRgbaTile,
  sourceOriginX: number,
  sourceOriginY: number,
  target: Float32Array,
  region: ImageEditorV3ExportRenderRegion,
): void {
  const left = Math.max(region.x, sourceOriginX)
  const top = Math.max(region.y, sourceOriginY)
  const right = Math.min(region.x + region.width, sourceOriginX + source.width)
  const bottom = Math.min(region.y + region.height, sourceOriginY + source.height)
  if (right <= left || bottom <= top) return
  const copyWidth = right - left
  for (let y = top; y < bottom; y += 1) {
    const sourceOffset = ((y - sourceOriginY) * source.width + left - sourceOriginX) * 4
    const targetOffset = ((y - region.y) * region.width + left - region.x) * 4
    target.set(source.data.subarray(sourceOffset, sourceOffset + copyWidth * 4), targetOffset)
  }
}

function validateReturnedTile(
  requested: ImageEditorV3ExportSourceTileRequest,
  tile: ImageEditorV3SourceTile,
): void {
  if (
    tile.resourceRef !== requested.resourceRef
    || tile.mip !== requested.mip
    || tile.tileX !== requested.tileX
    || tile.tileY !== requested.tileY
    || tile.halo !== requested.halo
    || tile.bitDepth !== requested.bitDepth
    || tile.channels !== 4
    || tile.alphaMode !== 'straight'
    || tile.pixels.byteLength < tile.rowStride * tile.height
  ) throw new Error(`图片源瓦片返回了不兼容的像素契约：${requested.resourceRef}`)
}

export async function loadImageEditorV3SourceRegion(
  resourceRef: string,
  region: ImageEditorV3ExportRenderRegion,
  canvasSize: { width: number; height: number },
  bitDepth: 8 | 16 | 32,
  targetWorkingSpace: ImageEditWorkingSpaceV3,
  targetTransferFunction: ImageEditTransferFunctionV3,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
  mip = 0,
): Promise<Float32PremultipliedRgbaTile> {
  if (!/^sha256:[a-f0-9]{64}$/.test(resourceRef)) {
    throw new Error(`图片编辑资源引用无效：${resourceRef}`)
  }
  const readTile = dependencies.readSourceTile ?? defaultReadSourceTile
  const output = new Float32Array(region.width * region.height * 4)
  const coordinates = enumerateTilesForRect(canvasSize, mip, region)
  for (const coordinate of coordinates) {
    throwIfAborted(signal)
    const request: ImageEditorV3ExportSourceTileRequest = {
      resourceRef: resourceRef as `sha256:${string}`,
      mip,
      tileX: coordinate.x,
      tileY: coordinate.y,
      halo: 0,
      bitDepth,
    }
    const tile = await readTile(request, signal)
    validateReturnedTile(request, tile)
    copyIntersection(
      decodeSourceTile(tile, targetWorkingSpace),
      tile.originX,
      tile.originY,
      output,
      region,
    )
  }
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    'linear-light',
    output,
    targetWorkingSpace,
    targetTransferFunction,
    203,
  )
}

export function imageEditorV3SourceRegionToMask(
  tile: Float32PremultipliedRgbaTile,
): Float32MaskTile {
  const perceptual = convertFloat32TileColorDomainV3(tile, 'perceptual-working')
  let usesAlpha = false
  for (let offset = 3; offset < perceptual.data.length; offset += 4) {
    if (perceptual.data[offset] < 1) {
      usesAlpha = true
      break
    }
  }
  const data = new Float32Array(tile.width * tile.height)
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    const offset = pixel * 4
    const alpha = Math.min(1, Math.max(0, perceptual.data[offset + 3]))
    if (usesAlpha) {
      data[pixel] = alpha
      continue
    }
    const inverseAlpha = alpha > 0 ? 1 / alpha : 0
    data[pixel] = Math.min(1, Math.max(0,
      perceptual.data[offset] * inverseAlpha * 0.2126
      + perceptual.data[offset + 1] * inverseAlpha * 0.7152
      + perceptual.data[offset + 2] * inverseAlpha * 0.0722,
    ))
  }
  return createFloat32MaskTile(tile.width, tile.height, data)
}
