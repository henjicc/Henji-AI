import { copyImageEditRepairSourceV3, mergeImageEditRepairPatchV3, type ImageEditRepairBitmapV3 } from '@/core/imageEdit/v3/repair'
import type { Float32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
export type RepairPixelsRequestV3 = { type: 'source'; tile: Float32PremultipliedRgbaTile; origin: { x: number; y: number }; bitmap: ImageEditRepairBitmapV3 }
  | { type: 'mask'; bitmap: ImageEditRepairBitmapV3; coverage: Float32Array }
  | { type: 'merge'; tile: Float32PremultipliedRgbaTile; origin: { x: number; y: number }; patch: Float32PremultipliedRgbaTile; bitmap: ImageEditRepairBitmapV3; guide?: { x: number; y: number; scale: number } }
self.onmessage = (event: MessageEvent<RepairPixelsRequestV3>): void => {
  try {
    const input = event.data
    if (input.type === 'source' || input.type === 'mask') {
      if (input.type === 'source') copyImageEditRepairSourceV3(input.tile, input.origin, input.bitmap)
      else input.bitmap.mask = Uint8Array.from(input.coverage, value => Math.round(value * 255))
      self.postMessage({ bitmap: input.bitmap }, [input.bitmap.rgba.buffer, input.bitmap.mask.buffer])
    } else { const data = mergeImageEditRepairPatchV3(input.tile, input.origin, input.patch, input.bitmap, input.guide); self.postMessage({ data }, [data.buffer]) }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
