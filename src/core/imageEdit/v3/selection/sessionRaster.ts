import { rasterizeSelectionCoverage } from './rasterize';
import type { ImageEditSelectionIntentShapeV3, ImageEditSelectionSessionV3, ImageEditSelectionRegionV3 } from './session';
import { applyFastBlurV3, resolveFastBlurV3Geometry } from '../effects/fastBlur';
import { createFloat32PremultipliedRgbaTile } from '../effects/contracts';

function shapeCoverage(shape: ImageEditSelectionIntentShapeV3, size: { width: number; height: number }, region: ImageEditSelectionRegionV3): Float32Array {
  if (shape.type !== 'brush') {
    const pixels = shape.type === 'lasso'
      ? { type: 'lasso' as const, points: shape.points.map(p => ({ x: p.x * size.width, y: p.y * size.height })) }
      : { ...shape, x: shape.x * size.width, y: shape.y * size.height, width: shape.width * size.width, height: shape.height * size.height };
    return rasterizeSelectionCoverage(region.width, region.height, region.x, region.y, pixels);
  }
  const output = new Float32Array(region.width * region.height);
  const radius = shape.radius * Math.min(size.width, size.height);
  // 连续圆头线段；只扫描每段相交的局部边界，笔迹点数没有产品上限。
  const points = shape.points.map(p => ({ x: p.x * size.width, y: p.y * size.height }));
  for (let index = 0; index < points.length; index++) {
    const a = points[Math.max(0, index - 1)], b = points[index];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - region.x - 1));
    const x1 = Math.min(region.width, Math.ceil(Math.max(a.x, b.x) + radius - region.x + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - region.y - 1));
    const y1 = Math.min(region.height, Math.ceil(Math.max(a.y, b.y) + radius - region.y + 1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const px = region.x + x + 0.5, py = region.y + y + 0.5;
      const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / length));
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(px - a.x - t * dx, py - a.y - t * dy)));
      output[y * region.width + x] = Math.max(output[y * region.width + x], coverage);
    }
  }
  return output;
}

/** 分块求值含完整羽化 halo；原始几何始终保留，重复羽化不累计。运行在 Worker。 */
export function rasterizeImageEditSessionRegionV3(selection: ImageEditSelectionSessionV3, size: { width: number; height: number }, region: ImageEditSelectionRegionV3): Float32Array {
  const radius = selection.feather * Math.min(size.width, size.height);
  // 大羽化沿共享 fast-blur 的低频策略：全局对齐的 mip，halo 不随大图线性膨胀。
  if (radius > 16) {
    const scale = 2 ** Math.ceil(Math.log2(radius / 16));
    const x = Math.floor(region.x / scale) - 1, y = Math.floor(region.y / scale) - 1;
    const lowRegion = { x, y, width: Math.ceil((region.x + region.width) / scale) - x + 1, height: Math.ceil((region.y + region.height) / scale) - y + 1 };
    const low = rasterizeImageEditSessionRegionV3(selection, { width: size.width / scale, height: size.height / scale }, lowRegion);
    const sample = (sx: number, sy: number) => low[Math.max(0, Math.min(lowRegion.height - 1, sy)) * lowRegion.width + Math.max(0, Math.min(lowRegion.width - 1, sx))];
    const output = new Float32Array(region.width * region.height);
    for (let py = 0; py < region.height; py++) for (let px = 0; px < region.width; px++) {
      const sx = (region.x + px + 0.5) / scale - x - 0.5, sy = (region.y + py + 0.5) / scale - y - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy;
      output[py * region.width + px] = (sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx) * (1 - ty) + (sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx) * ty;
    }
    return output;
  }
  const halo = resolveFastBlurV3Geometry({ radius, mip: 0 }).supportAtMip;
  const expanded = { x: region.x - halo, y: region.y - halo, width: region.width + halo * 2, height: region.height + halo * 2 };
  let coverage = new Float32Array(expanded.width * expanded.height);
  for (const operation of selection.operations) {
    const incoming = shapeCoverage(operation.shape, size, expanded);
    for (let i = 0; i < coverage.length; i++) {
      const old = operation.invertBefore ? 1 - coverage[i] : coverage[i], next = incoming[i];
      coverage[i] = operation.combine === 'replace' ? next : operation.combine === 'add' ? Math.max(old, next)
        : operation.combine === 'subtract' ? Math.max(0, old - next) : Math.min(old, next);
    }
  }
  // 文档外是零覆盖；反选仅在文档内生效。
  for (let y = 0; y < expanded.height; y++) for (let x = 0; x < expanded.width; x++) {
    const i = y * expanded.width + x;
    if (selection.inverted) coverage[i] = 1 - coverage[i];
    if (expanded.x + x < 0 || expanded.y + y < 0 || expanded.x + x >= size.width || expanded.y + y >= size.height) coverage[i] = 0;
  }
  if (radius > 0) {
    const rgba = new Float32Array(coverage.length * 4);
    for (let i = 0; i < coverage.length; i++) rgba.fill(coverage[i], i * 4, i * 4 + 4);
    const blurred = applyFastBlurV3(createFloat32PremultipliedRgbaTile(expanded.width, expanded.height, 'linear-light', rgba), { radius, mip: 0 });
    coverage = new Float32Array(coverage.length);
    for (let i = 0; i < coverage.length; i++) coverage[i] = blurred.data[i * 4 + 3];
  }
  const result = new Float32Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) result.set(coverage.subarray((y + halo) * expanded.width + halo, (y + halo) * expanded.width + halo + region.width), y * region.width);
  return result;
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
