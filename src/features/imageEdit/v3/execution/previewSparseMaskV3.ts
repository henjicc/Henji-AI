import { createFloat32MaskTile, type Float32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorPreviewDimensionsV3 } from './previewPixelsV3'
import type { ImageEditorPreviewBrushTileV3 } from './previewProtocolV3'

function replaceScaledMaskTile(
  output: Float32Array,
  outputWidth: number,
  outputHeight: number,
  tile: ImageEditorPreviewBrushTileV3,
  tileX: number,
  tileY: number,
  dimensions: ImageEditorPreviewDimensionsV3,
): void {
  if (tile.storage !== 'mask-float32') throw new Error('蒙版引用指向了非蒙版画笔瓦片')
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
      const topValue = source[y0 * tile.width + x0]
        + (source[y0 * tile.width + x1] - source[y0 * tile.width + x0]) * tx
      const bottomValue = source[y1 * tile.width + x0]
        + (source[y1 * tile.width + x1] - source[y1 * tile.width + x0]) * tx
      output[y * outputWidth + x] = topValue + (bottomValue - topValue) * ty
    }
  }
}

export function loadPreviewSparseMaskV3(
  mask: ImageEditSparseMaskReferenceV3,
  brushTiles: ReadonlyMap<string, ImageEditorPreviewBrushTileV3>,
  dimensions: ImageEditorPreviewDimensionsV3,
): Float32MaskTile {
  const output = new Float32Array(dimensions.width * dimensions.height)
  if (mask.defaultValue === 1) output.fill(1)
  for (const [tileKey, resourceId] of Object.entries(mask.tiles)) {
    const parts = tileKey.split('/')
    if (parts.length !== 3 || Number(parts[0]) !== 0) {
      throw new Error(`图片预览蒙版瓦片键无效：${tileKey}`)
    }
    const tileX = Number(parts[1])
    const tileY = Number(parts[2])
    if (!Number.isSafeInteger(tileX) || tileX < 0 || !Number.isSafeInteger(tileY) || tileY < 0) {
      throw new Error(`图片预览蒙版瓦片坐标无效：${tileKey}`)
    }
    const tile = brushTiles.get(resourceId)
    if (!tile) throw new Error(`图片预览缺少蒙版瓦片：${resourceId}`)
    replaceScaledMaskTile(output, dimensions.width, dimensions.height, tile, tileX, tileY, dimensions)
  }
  return createFloat32MaskTile(dimensions.width, dimensions.height, output)
}
