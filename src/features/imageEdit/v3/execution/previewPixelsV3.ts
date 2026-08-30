import {
  convertFloat32TileColorDomainV3,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  decodeSrgbExtended,
  encodeSrgbExtended,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { MarkItem } from '@/core/imageEdit/types'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import type { ImageEditorPreviewProxyV3 } from './previewProtocolV3'

export class ImageEditorPreviewUnsupportedContentErrorV3 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageEditorPreviewUnsupportedContentErrorV3'
  }
}

export interface ImageEditorPreviewDimensionsV3 {
  width: number
  height: number
  scaleX: number
  scaleY: number
}

export function resolveImageEditorPreviewDimensionsV3(
  document: ImageEditDocumentV3,
  maxDimension: number,
): ImageEditorPreviewDimensionsV3 {
  const sourceWidth = Math.max(1, document.geometry.width)
  const sourceHeight = Math.max(1, document.geometry.height)
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  return { width, height, scaleX: width / sourceWidth, scaleY: height / sourceHeight }
}

export function createTransparentPreviewTileV3(
  width: number,
  height: number,
): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(
    width,
    height,
    'linear-light',
    new Float32Array(width * height * 4),
  )
}

function createCanvas(width: number, height: number): {
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
} {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Worker 无法创建图片预览画布')
  return { canvas, context }
}

export async function decodePreviewProxyBitmapV3(
  proxy: ImageEditorPreviewProxyV3,
): Promise<ImageBitmap> {
  return await createImageBitmap(new Blob([proxy.bytes], { type: proxy.mediaType }))
}

export function imageDataToLinearPreviewTileV3(imageData: ImageData): Float32PremultipliedRgbaTile {
  const output = new Float32Array(imageData.width * imageData.height * 4)
  for (let offset = 0; offset < output.length; offset += 4) {
    const alpha = imageData.data[offset + 3] / 255
    output[offset] = decodeSrgbExtended(imageData.data[offset] / 255) * alpha
    output[offset + 1] = decodeSrgbExtended(imageData.data[offset + 1] / 255) * alpha
    output[offset + 2] = decodeSrgbExtended(imageData.data[offset + 2] / 255) * alpha
    output[offset + 3] = alpha
  }
  return createFloat32PremultipliedRgbaTile(
    imageData.width,
    imageData.height,
    'linear-light',
    output,
  )
}

export function linearPreviewTileToImageDataV3(tile: Float32PremultipliedRgbaTile): ImageData {
  const linear = convertFloat32TileColorDomainV3(tile, 'linear-light')
  const output = new Uint8ClampedArray(linear.width * linear.height * 4)
  for (let offset = 0; offset < output.length; offset += 4) {
    const alpha = Math.min(1, Math.max(0, linear.data[offset + 3]))
    const inverseAlpha = alpha > 0 ? 1 / alpha : 0
    output[offset] = Math.round(clamp01(encodeSrgbExtended(linear.data[offset] * inverseAlpha)) * 255)
    output[offset + 1] = Math.round(clamp01(encodeSrgbExtended(linear.data[offset + 1] * inverseAlpha)) * 255)
    output[offset + 2] = Math.round(clamp01(encodeSrgbExtended(linear.data[offset + 2] * inverseAlpha)) * 255)
    output[offset + 3] = Math.round(alpha * 255)
  }
  return new ImageData(output, linear.width, linear.height)
}

export async function linearPreviewTileToBitmapV3(
  tile: Float32PremultipliedRgbaTile,
): Promise<ImageBitmap> {
  const { canvas, context } = createCanvas(tile.width, tile.height)
  context.putImageData(linearPreviewTileToImageDataV3(tile), 0, 0)
  return canvas.transferToImageBitmap()
}

export async function previewBitmapToLinearTileV3(
  bitmap: ImageBitmap,
  width = bitmap.width,
  height = bitmap.height,
): Promise<Float32PremultipliedRgbaTile> {
  const { context } = createCanvas(width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  return imageDataToLinearPreviewTileV3(context.getImageData(0, 0, width, height))
}

export async function rasterizePreviewLayerV3(
  node: ImageEditRenderPlanNode,
  proxies: ReadonlyMap<string, ImageEditorPreviewProxyV3>,
  dimensions: ImageEditorPreviewDimensionsV3,
): Promise<Float32PremultipliedRgbaTile> {
  const { canvas, context } = createCanvas(dimensions.width, dimensions.height)
  const source = isRecord(node.parameters.source) ? node.parameters.source : null
  if (source?.kind === 'resource' && typeof source.resourceId === 'string') {
    await drawProxy(context, proxies, source.resourceId, 0, 0, dimensions.width, dimensions.height)
  }
  const tiles = isRecord(node.parameters.tiles) ? node.parameters.tiles : {}
  for (const [tileKey, resourceId] of Object.entries(tiles)) {
    if (typeof resourceId !== 'string') continue
    const [mipValue, tileXValue, tileYValue] = tileKey.split('/')
    const mip = Number(mipValue)
    const tileX = Number(tileXValue)
    const tileY = Number(tileYValue)
    if (mip !== 0 || !Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) continue
    const proxy = proxies.get(resourceId)
    if (!proxy) throw new Error(`预览缺少栅格瓦片资源：${resourceId}`)
    const width = proxy.width * dimensions.scaleX
    const height = proxy.height * dimensions.scaleY
    await drawProxy(
      context,
      proxies,
      resourceId,
      tileX * 512 * dimensions.scaleX,
      tileY * 512 * dimensions.scaleY,
      width,
      height,
    )
  }
  return imageDataToLinearPreviewTileV3(
    context.getImageData(0, 0, canvas.width, canvas.height),
  )
}

export function rasterizePreviewAnnotationsV3(
  node: ImageEditRenderPlanNode,
  document: ImageEditDocumentV3,
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32PremultipliedRgbaTile {
  const annotations = Array.isArray(node.parameters.annotations)
    ? node.parameters.annotations as MarkItem[]
    : []
  if (annotations.some((annotation) => annotation.type === 'mosaic')) {
    throw new ImageEditorPreviewUnsupportedContentErrorV3(
      '马赛克标注需要迁移为效果图层后才能在 V3 预览中求值',
    )
  }
  const { canvas, context } = createCanvas(dimensions.width, dimensions.height)
  context.save()
  context.scale(dimensions.scaleX, dimensions.scaleY)
  drawMarkItems(
    context,
    annotations,
    document.geometry.width,
    document.geometry.height,
    { canvasKind: 'offscreen' },
  )
  context.restore()
  return imageDataToLinearPreviewTileV3(
    context.getImageData(0, 0, canvas.width, canvas.height),
  )
}

export async function loadPreviewMaskV3(
  resourceId: string,
  proxies: ReadonlyMap<string, ImageEditorPreviewProxyV3>,
  dimensions: ImageEditorPreviewDimensionsV3,
): Promise<Float32MaskTile> {
  const proxy = proxies.get(resourceId)
  if (!proxy) throw new Error(`预览缺少蒙版资源：${resourceId}`)
  const { context } = createCanvas(dimensions.width, dimensions.height)
  await drawProxy(context, proxies, resourceId, 0, 0, dimensions.width, dimensions.height)
  const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height).data
  const hasTransparency = pixels.some((value, index) => index % 4 === 3 && value < 255)
  const mask = new Float32Array(dimensions.width * dimensions.height)
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4
    mask[pixel] = hasTransparency
      ? pixels[offset + 3] / 255
      : (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255
  }
  return createFloat32MaskTile(dimensions.width, dimensions.height, mask)
}

export function transformPreviewTileV3(
  tile: Float32PremultipliedRgbaTile,
  transform: readonly number[],
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32PremultipliedRgbaTile {
  const [a, b, c, d, e, f] = transform
  const scaled = [
    a,
    b * dimensions.scaleY / dimensions.scaleX,
    c * dimensions.scaleX / dimensions.scaleY,
    d,
    e * dimensions.scaleX,
    f * dimensions.scaleY,
  ]
  const determinant = scaled[0] * scaled[3] - scaled[1] * scaled[2]
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    throw new Error('图层变换矩阵不可逆')
  }
  const output = new Float32Array(tile.data.length)
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const px = x - scaled[4]
      const py = y - scaled[5]
      const sourceX = (scaled[3] * px - scaled[2] * py) / determinant
      const sourceY = (-scaled[1] * px + scaled[0] * py) / determinant
      sampleNearest(tile, sourceX, sourceY, output, (y * tile.width + x) * 4)
    }
  }
  return createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    tile.colorDomain,
    output,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  )
}

function sampleNearest(
  tile: Float32PremultipliedRgbaTile,
  x: number,
  y: number,
  output: Float32Array,
  outputOffset: number,
): void {
  const sourceX = Math.round(x)
  const sourceY = Math.round(y)
  if (sourceX < 0 || sourceY < 0 || sourceX >= tile.width || sourceY >= tile.height) return
  const sourceOffset = (sourceY * tile.width + sourceX) * 4
  output.set(tile.data.subarray(sourceOffset, sourceOffset + 4), outputOffset)
}

async function drawProxy(
  context: OffscreenCanvasRenderingContext2D,
  proxies: ReadonlyMap<string, ImageEditorPreviewProxyV3>,
  resourceId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const proxy = proxies.get(resourceId)
  if (!proxy) throw new Error(`预览缺少图片资源：${resourceId}`)
  const bitmap = await decodePreviewProxyBitmapV3(proxy)
  try {
    context.drawImage(bitmap, x, y, width, height)
  } finally {
    bitmap.close()
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
