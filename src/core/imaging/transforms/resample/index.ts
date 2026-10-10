import { inverseAffine, type Affine } from '..';
import type { RegionRect } from '../../regions';

export interface SamplingPixels { width: number; height: number; data: Float32Array }
/** Pixel centres, transparent outside; premultiplied colour and coverage use identical weights. */
export function resampleAffinePixels(source: SamplingPixels, sourceRect: RegionRect, outputRect: RegionRect,
  transform: Affine, channels: 1 | 4): Float32Array {
  if (source.width !== sourceRect.width || source.height !== sourceRect.height || source.data.length !== source.width * source.height * channels)
    throw new Error('重采样来源与区域尺寸不一致');
  const inverse = inverseAffine(transform), data = new Float32Array(outputRect.width * outputRect.height * channels);
  for (let y = 0; y < outputRect.height; y++) for (let x = 0; x < outputRect.width; x++) {
    const gx = outputRect.x + x + .5, gy = outputRect.y + y + .5;
    const sx = inverse[0] * gx + inverse[2] * gy + inverse[4] - sourceRect.x - .5;
    const sy = inverse[1] * gx + inverse[3] * gy + inverse[5] - sourceRect.y - .5;
    sampleBilinearPixels(source, sx, sy, channels, data, (y * outputRect.width + x) * channels);
  }
  return data;
}
export function sampleBilinearPixels(source: SamplingPixels, x: number, y: number, channels: 1 | 4,
  output: Float32Array, offset: number, edge: 'transparent' | 'clamp' = 'transparent'): void {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const x0 = edge === 'clamp' ? Math.max(0, Math.min(source.width - 1, ix)) : ix;
  const y0 = edge === 'clamp' ? Math.max(0, Math.min(source.height - 1, iy)) : iy;
  const x1 = edge === 'clamp' ? Math.max(0, Math.min(source.width - 1, ix + 1)) : ix + 1;
  const y1 = edge === 'clamp' ? Math.max(0, Math.min(source.height - 1, iy + 1)) : iy + 1;
  const a = x0 < 0 || y0 < 0 || x0 >= source.width || y0 >= source.height ? -1 : (y0 * source.width + x0) * channels;
  const b = x1 < 0 || y0 < 0 || x1 >= source.width || y0 >= source.height ? -1 : (y0 * source.width + x1) * channels;
  const c = x0 < 0 || y1 < 0 || x0 >= source.width || y1 >= source.height ? -1 : (y1 * source.width + x0) * channels;
  const d = x1 < 0 || y1 < 0 || x1 >= source.width || y1 >= source.height ? -1 : (y1 * source.width + x1) * channels;
  // Sum in JS double precision and round once, as the original affine kernel did.
  // Rounding each contribution to Float32 can turn opaque alpha into 1.000000119.
  for (let channel = 0; channel < channels; channel++) output[offset + channel] =
    (a < 0 ? 0 : source.data[a + channel]) * (1 - fx) * (1 - fy)
    + (b < 0 ? 0 : source.data[b + channel]) * fx * (1 - fy)
    + (c < 0 ? 0 : source.data[c + channel]) * (1 - fx) * fy
    + (d < 0 ? 0 : source.data[d + channel]) * fx * fy;
}
