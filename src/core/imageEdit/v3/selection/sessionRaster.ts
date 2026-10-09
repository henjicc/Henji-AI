import { evaluateRegionProgram } from '../../../imaging/regions/evaluate';
import type { RegionFeatherPort } from '../../../imaging/regions/contracts';
import type { ImageEditSelectionSessionV3, ImageEditSelectionRegionV3 } from './session';
import { applyFastBlurV3, resolveFastBlurV3Geometry } from '../effects/fastBlur';
import { createFloat32PremultipliedRgbaTile } from '../effects/contracts';

const imageEditRegionFeather: RegionFeatherPort = {
  support: radius => resolveFastBlurV3Geometry({ radius, mip: 0 }).supportAtMip,
  apply: (coverage, grid, radius) => {
    const rgba = new Float32Array(coverage.length * 4);
    for (let i = 0; i < coverage.length; i++) rgba.fill(coverage[i], i * 4, i * 4 + 4);
    const blurred = applyFastBlurV3(createFloat32PremultipliedRgbaTile(grid.width, grid.height, 'linear-light', rgba), { radius, mip: 0 });
    return Float32Array.from(coverage, (_, i) => blurred.data[i * 4 + 3]);
  },
};

/** Image-specific feather adapter; geometry, boolean operations and sampling live in imaging/regions. */
export function rasterizeImageEditSessionRegionV3(selection: ImageEditSelectionSessionV3, size: { width: number; height: number }, region: ImageEditSelectionRegionV3): Float32Array {
  return evaluateRegionProgram(selection, size, region, imageEditRegionFeather);
}

/** ie2 协议：源图同尺寸单通道 0..255 位图，ROI 是像素正整数矩形。逐块交付，不物化整图。 */
export async function* exportImageEditSelectionMaskV3(selection: ImageEditSelectionSessionV3, size: { width: number; height: number }, rasterize: (selection: ImageEditSelectionSessionV3, region: ImageEditSelectionRegionV3) => Promise<Float32Array>, signal?: AbortSignal) {
  let left = size.width, top = size.height, right = 0, bottom = 0;
  for (let y = 0; y < size.height; y += 512) for (let x = 0; x < size.width; x += 512) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const region = { x, y, width: Math.min(512, size.width - x), height: Math.min(512, size.height - y) };
    const coverage = await rasterize(selection, region);
    if (signal?.aborted) throw new Error('CANCELLED');
    const bitmap = new Uint8Array(coverage.length);
    for (let i = 0; i < coverage.length; i++) {
      bitmap[i] = Math.round(coverage[i] * 255);
      if (bitmap[i] > 0) { const px = x + i % region.width, py = y + Math.floor(i / region.width); left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px + 1); bottom = Math.max(bottom, py + 1); }
    }
    yield { region, bitmap };
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
