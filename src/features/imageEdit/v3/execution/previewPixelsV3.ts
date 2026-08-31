import {
  convertFloat32TileColorDomainV3,
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
  decodeSrgbExtended,
  encodeSrgbExtended,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  scaleImageEditTransformV3,
} from '@/core/imageEdit/v3'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import type { MarkItem } from '@/core/imageEdit/types'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import type {
  ImageEditorPreviewBrushTileV3,
  ImageEditorPreviewProxyV3,
} from './previewProtocolV3'

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
  return imageDataToLinearPreviewTileV3(
    context.getImageData(0, 0, canvas.width, canvas.height),
  )
}

export function createPreviewBrushTileMapV3(
  tiles: readonly ImageEditorPreviewBrushTileV3[],
): ReadonlyMap<string, ImageEditorPreviewBrushTileV3> {
  const result = new Map<string, ImageEditorPreviewBrushTileV3>()
  for (const tile of tiles) {
    const expectedBytes = tile.width * tile.height
      * (tile.storage === 'rgba-float32' ? 4 : 1)
      * Float32Array.BYTES_PER_ELEMENT
    if (typeof tile.resourceId !== 'string'
      || !Number.isSafeInteger(tile.width)
      || !Number.isSafeInteger(tile.height)
      || tile.width < 1
      || tile.height < 1
      || tile.width > 512
      || tile.height > 512
      || !(tile.bytes instanceof ArrayBuffer)
      || tile.bytes.byteLength !== expectedBytes) {
      throw new Error(`图片预览画笔瓦片像素契约无效：${String(tile.resourceId)}`)
    }
    if (result.has(tile.resourceId)) {
      throw new Error(`图片预览收到重复画笔瓦片资源：${tile.resourceId}`)
    }
    result.set(tile.resourceId, tile)
  }
  return result
}

/** 画笔瓦片是栅格源对应区域的完整替换；透明像素会清空本图层并露出下层。 */
export function applyPreviewBrushTileReplacementsV3(
  node: ImageEditRenderPlanNode,
  base: Float32PremultipliedRgbaTile,
  brushTiles: ReadonlyMap<string, ImageEditorPreviewBrushTileV3>,
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32PremultipliedRgbaTile {
  const tileReferences = isRecord(node.parameters.tiles) ? node.parameters.tiles : {}
  if (Object.keys(tileReferences).length === 0) return base
  const output = new Float32Array(base.data)
  for (const [tileKey, resourceId] of Object.entries(tileReferences)) {
    if (typeof resourceId !== 'string') {
      throw new Error(`图片预览栅格瓦片资源无效：${tileKey}`)
    }
    const [mipValue, tileXValue, tileYValue, extra] = tileKey.split('/')
    const mip = Number(mipValue)
    const tileX = Number(tileXValue)
    const tileY = Number(tileYValue)
    if (extra !== undefined
      || mip !== 0
      || !Number.isSafeInteger(tileX)
      || !Number.isSafeInteger(tileY)
      || tileX < 0
      || tileY < 0) {
      throw new Error(`图片预览栅格瓦片键无效：${tileKey}`)
    }
    const tile = brushTiles.get(resourceId)
    if (!tile) throw new Error(`图片预览缺少栅格画笔瓦片：${resourceId}`)
    if (tile.storage !== 'rgba-float32') {
      throw new Error(`栅格图层引用了非 RGBA 画笔瓦片：${resourceId}`)
    }
    replaceScaledBrushTile(output, base.width, base.height, tile, tileX, tileY, dimensions)
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

function replaceScaledBrushTile(
  output: Float32Array,
  outputWidth: number,
  outputHeight: number,
  tile: ImageEditorPreviewBrushTileV3,
  tileX: number,
  tileY: number,
  dimensions: ImageEditorPreviewDimensionsV3,
): void {
  const source = new Float32Array(tile.bytes)
  const originX = tileX * 512
  const originY = tileY * 512
  const left = Math.max(0, Math.floor(originX * dimensions.scaleX))
  const top = Math.max(0, Math.floor(originY * dimensions.scaleY))
  const right = Math.min(outputWidth, Math.ceil((originX + tile.width) * dimensions.scaleX))
  const bottom = Math.min(outputHeight, Math.ceil((originY + tile.height) * dimensions.scaleY))
  for (let y = top; y < bottom; y += 1) {
    const sourceY = (y + 0.5) / dimensions.scaleY - originY - 0.5
    const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(sourceY)))
    const y1 = Math.min(tile.height - 1, y0 + 1)
    const ty = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)))
    for (let x = left; x < right; x += 1) {
      const sourceX = (x + 0.5) / dimensions.scaleX - originX - 0.5
      const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(sourceX)))
      const x1 = Math.min(tile.width - 1, x0 + 1)
      const tx = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)))
      const outputOffset = (y * outputWidth + x) * 4
      const topLeft = (y0 * tile.width + x0) * 4
      const topRight = (y0 * tile.width + x1) * 4
      const bottomLeft = (y1 * tile.width + x0) * 4
      const bottomRight = (y1 * tile.width + x1) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const topValue = source[topLeft + channel]
          + (source[topRight + channel] - source[topLeft + channel]) * tx
        const bottomValue = source[bottomLeft + channel]
          + (source[bottomRight + channel] - source[bottomLeft + channel]) * tx
        output[outputOffset + channel] = topValue + (bottomValue - topValue) * ty
      }
    }
  }
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
  const region = { x: 0, y: 0, width: tile.width, height: tile.height }
  return resampleImageEditRgbaAffineV3(
    tile,
    region,
    region,
    scaleImageEditTransformV3(transform, dimensions.scaleX, dimensions.scaleY),
  )
}

export function transformPreviewMaskV3(
  mask: Float32MaskTile,
  transform: readonly number[],
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32MaskTile {
  const region = { x: 0, y: 0, width: mask.width, height: mask.height }
  return resampleImageEditMaskAffineV3(
    mask,
    region,
    region,
    scaleImageEditTransformV3(transform, dimensions.scaleX, dimensions.scaleY),
  )
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
