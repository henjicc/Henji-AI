import type { Float32MaskTile } from '@/core/imageEdit/v3/effects/contracts'

/** 编辑态 overlay 使用半透明灰阶显示蒙版；不参与权威像素或导出。 */
export function maskBrushTileToImageDataV3(tile: Float32MaskTile): ImageData {
  const pixels = new Uint8ClampedArray(tile.width * tile.height * 4)
  for (let index = 0; index < tile.data.length; index += 1) {
    const value = Math.round(Math.min(1, Math.max(0, tile.data[index])) * 255)
    const offset = index * 4
    pixels[offset] = value
    pixels[offset + 1] = value
    pixels[offset + 2] = value
    pixels[offset + 3] = Math.round(value * 0.55)
  }
  return new ImageData(pixels, tile.width, tile.height)
}
