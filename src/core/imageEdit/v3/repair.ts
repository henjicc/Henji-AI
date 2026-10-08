import type { Float32PremultipliedRgbaTile } from './effects/contracts'

export interface ImageEditRepairRectV3 { x: number; y: number; width: number; height: number }
export interface ImageEditRepairBitmapV3 { region: ImageEditRepairRectV3; rgba: Uint8Array; mask: Uint8Array; sampleScale?: number }

/** 仅转换交给 SDR 模型的副本；原浮点瓦片及 alpha 不量化。运行于 Worker。 */
export function copyImageEditRepairSourceV3(tile: Float32PremultipliedRgbaTile, origin: { x: number; y: number }, output: ImageEditRepairBitmapV3): void {
  const scale = output.sampleScale ?? 1
  for (let y = Math.max(0, Math.ceil((origin.y - output.region.y) / scale)); y < Math.min(output.region.height, Math.ceil((origin.y + tile.height - output.region.y) / scale)); y++) {
    for (let x = Math.max(0, Math.ceil((origin.x - output.region.x) / scale)); x < Math.min(output.region.width, Math.ceil((origin.x + tile.width - output.region.x) / scale)); x++) {
      const from = ((Math.floor(output.region.y + y * scale) - origin.y) * tile.width + Math.floor(output.region.x + x * scale) - origin.x) * 4
      const to = (y * output.region.width + x) * 4
      const alpha = tile.data[from + 3]
      for (let c = 0; c < 3; c++) {
        const v = alpha > 0 ? Math.max(0, Math.min(1, tile.data[from + c] / alpha)) : 0
        output.rgba[to + c] = Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255)
      }
      output.rgba[to + 3] = Math.round(alpha * 255)
    }
  }
}

/** 原覆盖率已由推理内核融合；只替换非零选区的 RGB，精确保留原 alpha 与非选区浮点值。 */
export function mergeImageEditRepairPatchV3(tile: Float32PremultipliedRgbaTile, origin: { x: number; y: number }, patch: Float32PremultipliedRgbaTile, bitmap: ImageEditRepairBitmapV3, guide?: { x: number; y: number; scale: number }): Float32Array {
  const output = new Float32Array(tile.data)
  for (let y = Math.max(origin.y, bitmap.region.y); y < Math.min(origin.y + tile.height, bitmap.region.y + bitmap.region.height); y++) {
    for (let x = Math.max(origin.x, bitmap.region.x); x < Math.min(origin.x + tile.width, bitmap.region.x + bitmap.region.width); x++) {
      const p = (y - bitmap.region.y) * bitmap.region.width + x - bitmap.region.x
      if (!bitmap.mask[p]) continue
      const to = ((y - origin.y) * tile.width + x - origin.x) * 4
      const alpha = output[to + 3]
      const px = guide ? Math.max(0, Math.min(patch.width - 1, (x - guide.x) / guide.scale)) : x - bitmap.region.x
      const py = guide ? Math.max(0, Math.min(patch.height - 1, (y - guide.y) / guide.scale)) : y - bitmap.region.y
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy
      const value = (channel: number): number => {
        const a = patch.data[(iy * patch.width + ix) * 4 + channel], b = patch.data[(iy * patch.width + Math.min(ix + 1, patch.width - 1)) * 4 + channel]
        const c = patch.data[(Math.min(iy + 1, patch.height - 1) * patch.width + ix) * 4 + channel], d = patch.data[(Math.min(iy + 1, patch.height - 1) * patch.width + Math.min(ix + 1, patch.width - 1)) * 4 + channel]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      }
      const patchAlpha = value(3)
      for (let c = 0; c < 3; c++) output[to + c] = patchAlpha > 0 ? value(c) / patchAlpha * alpha : 0
    }
  }
  return output
}
