import type {
  ImageEditCanvasGeometryV3,
  ImageEditRotationV3,
} from './documentTypes'
import type { ImageEditRect, ImageEditSize } from './tileGeometry'

export interface ImageEditOutputGeometryV3 {
  sourceWidth: number
  sourceHeight: number
  orientedWidth: number
  orientedHeight: number
  outputWidth: number
  outputHeight: number
  cropX: number
  cropY: number
  rotate: ImageEditRotationV3
  mirrored: boolean
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} 必须是整数`)
  return value
}

export function resolveImageEditOutputGeometryV3(
  geometry: ImageEditCanvasGeometryV3,
): ImageEditOutputGeometryV3 {
  const sourceWidth = safeInteger(geometry.width, '文档宽度')
  const sourceHeight = safeInteger(geometry.height, '文档高度')
  const { rotate, mirrored } = geometry.orientation
  const swapsAxes = rotate === 90 || rotate === 270
  const orientedWidth = swapsAxes ? sourceHeight : sourceWidth
  const orientedHeight = swapsAxes ? sourceWidth : sourceHeight
  const cropX = geometry.crop ? safeInteger(geometry.crop.x, '裁剪横坐标') : 0
  const cropY = geometry.crop ? safeInteger(geometry.crop.y, '裁剪纵坐标') : 0
  const outputWidth = geometry.crop ? safeInteger(geometry.crop.width, '裁剪宽度') : orientedWidth
  const outputHeight = geometry.crop ? safeInteger(geometry.crop.height, '裁剪高度') : orientedHeight
  if (
    sourceWidth < 1
    || sourceHeight < 1
    || cropX < 0
    || cropY < 0
    || outputWidth < 1
    || outputHeight < 1
    || cropX + outputWidth > orientedWidth
    || cropY + outputHeight > orientedHeight
  ) throw new Error('图片编辑输出几何超出文档范围')
  return {
    sourceWidth,
    sourceHeight,
    orientedWidth,
    orientedHeight,
    outputWidth,
    outputHeight,
    cropX,
    cropY,
    rotate,
    mirrored,
  }
}

export function imageEditOutputSizeV3(geometry: ImageEditCanvasGeometryV3): ImageEditSize {
  const resolved = resolveImageEditOutputGeometryV3(geometry)
  return { width: resolved.outputWidth, height: resolved.outputHeight }
}

export function imageEditOutputMipSizeV3(
  geometry: ImageEditCanvasGeometryV3,
  mip: number,
): ImageEditSize {
  const size = imageEditOutputSizeV3(geometry)
  const scale = 2 ** mip
  return {
    width: Math.max(1, Math.ceil(size.width / scale)),
    height: Math.max(1, Math.ceil(size.height / scale)),
  }
}

export function createImageEditGeometryHashV3(geometry: ImageEditCanvasGeometryV3): string {
  const resolved = resolveImageEditOutputGeometryV3(geometry)
  return [
    resolved.sourceWidth,
    resolved.sourceHeight,
    resolved.rotate,
    resolved.mirrored ? 1 : 0,
    resolved.cropX,
    resolved.cropY,
    resolved.outputWidth,
    resolved.outputHeight,
  ].join(':')
}

export function mapImageEditOutputPixelToSourceV3(
  outputX: number,
  outputY: number,
  geometry: ImageEditOutputGeometryV3,
): readonly [number, number] {
  const orientedX = outputX + geometry.cropX
  const orientedY = outputY + geometry.cropY
  let mirroredX: number
  let sourceY: number
  if (geometry.rotate === 90) {
    mirroredX = orientedY
    sourceY = geometry.sourceHeight - 1 - orientedX
  } else if (geometry.rotate === 180) {
    mirroredX = geometry.sourceWidth - 1 - orientedX
    sourceY = geometry.sourceHeight - 1 - orientedY
  } else if (geometry.rotate === 270) {
    mirroredX = geometry.sourceWidth - 1 - orientedY
    sourceY = orientedX
  } else {
    mirroredX = orientedX
    sourceY = orientedY
  }
  const sourceX = geometry.mirrored
    ? geometry.sourceWidth - 1 - mirroredX
    : mirroredX
  return [sourceX, sourceY]
}

export function mapImageEditOutputMipPixelToSourceMipV3(
  outputX: number,
  outputY: number,
  mip: number,
  geometry: ImageEditOutputGeometryV3,
): readonly [number, number] {
  const scale = 2 ** mip
  const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(
    Math.min(geometry.outputWidth - 1, outputX * scale),
    Math.min(geometry.outputHeight - 1, outputY * scale),
    geometry,
  )
  return [Math.floor(sourceX / scale), Math.floor(sourceY / scale)]
}

function alignDown(value: number, alignment: number): number {
  return Math.floor(value / alignment) * alignment
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

/** 把输出 ROI 原子映射回内容坐标；裁剪和方向永远不进入节点瓦片 key。 */
export function resolveImageEditOutputSourceRectV3(
  outputRect: ImageEditRect,
  geometry: ImageEditOutputGeometryV3,
  halo = 0,
  alignment = 1,
): ImageEditRect {
  const right = outputRect.x + outputRect.width - 1
  const bottom = outputRect.y + outputRect.height - 1
  const points = [
    mapImageEditOutputPixelToSourceV3(outputRect.x, outputRect.y, geometry),
    mapImageEditOutputPixelToSourceV3(right, outputRect.y, geometry),
    mapImageEditOutputPixelToSourceV3(outputRect.x, bottom, geometry),
    mapImageEditOutputPixelToSourceV3(right, bottom, geometry),
  ]
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.max(0, alignDown(Math.min(...xs) - halo, alignment))
  const top = Math.max(0, alignDown(Math.min(...ys) - halo, alignment))
  const sourceRight = Math.min(
    geometry.sourceWidth,
    alignUp(Math.max(...xs) + 1 + halo, alignment),
  )
  const sourceBottom = Math.min(
    geometry.sourceHeight,
    alignUp(Math.max(...ys) + 1 + halo, alignment),
  )
  return { x: left, y: top, width: sourceRight - left, height: sourceBottom - top }
}

export function resolveImageEditOutputSourceRectAtMipV3(
  outputRect: ImageEditRect,
  geometry: ImageEditOutputGeometryV3,
  mip: number,
  halo = 0,
): ImageEditRect {
  const scale = 2 ** mip
  const sourceWidth = Math.max(1, Math.ceil(geometry.sourceWidth / scale))
  const sourceHeight = Math.max(1, Math.ceil(geometry.sourceHeight / scale))
  const right = outputRect.x + outputRect.width - 1
  const bottom = outputRect.y + outputRect.height - 1
  const points = [
    mapImageEditOutputMipPixelToSourceMipV3(outputRect.x, outputRect.y, mip, geometry),
    mapImageEditOutputMipPixelToSourceMipV3(right, outputRect.y, mip, geometry),
    mapImageEditOutputMipPixelToSourceMipV3(outputRect.x, bottom, mip, geometry),
    mapImageEditOutputMipPixelToSourceMipV3(right, bottom, mip, geometry),
  ]
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.max(0, Math.min(...xs) - halo)
  const top = Math.max(0, Math.min(...ys) - halo)
  const sourceRight = Math.min(sourceWidth, Math.max(...xs) + 1 + halo)
  const sourceBottom = Math.min(sourceHeight, Math.max(...ys) + 1 + halo)
  return { x: left, y: top, width: sourceRight - left, height: sourceBottom - top }
}
