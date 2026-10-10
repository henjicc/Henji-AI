import { inverseAffine } from '../transforms';
import type { Coverage, RegionCombine, RegionRect, RegionTransform } from './contracts';

export function throwIfRegionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('区域求值已取消');
  error.name = 'AbortError';
  throw error;
}

export function assertRegionRect(rect: RegionRect): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    || rect.width < 1 || rect.height < 1 || !Number.isSafeInteger(rect.width * rect.height)) {
    throw new Error('区域矩形必须使用整数坐标和正尺寸');
  }
}

export function assertCoverage(coverage: Coverage): void {
  assertRegionRect(coverage);
  if (!(coverage.data instanceof Float32Array) || coverage.data.length !== coverage.width * coverage.height) {
    throw new Error('区域覆盖数据与尺寸不一致');
  }
  for (const value of coverage.data) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('区域覆盖必须是 0..1 的有限值');
  }
}

export function combineRegionCoverage(existing: number, incoming: number, mode: RegionCombine): number {
  switch (mode) {
    case 'replace': return incoming;
    case 'add': return Math.max(existing, incoming);
    case 'subtract': return Math.max(0, existing - incoming);
    case 'intersect': return Math.min(existing, incoming);
    case 'paint': return incoming + existing * (1 - incoming);
    case 'erase': return existing * (1 - incoming);
    default: throw new Error('不支持的区域组合方式');
  }
}

/** Bilinear sampling uses pixel centers; absent texels use the declared default, never a hardcoded zero. */
export function sampleRegionCoverage(coverage: Coverage, x: number, y: number, defaultValue: number): number {
  const ix = Math.floor(x - coverage.x - 0.5), iy = Math.floor(y - coverage.y - 0.5);
  const fx = x - coverage.x - 0.5 - ix, fy = y - coverage.y - 0.5 - iy;
  const at = (px: number, py: number): number => px < 0 || py < 0 || px >= coverage.width || py >= coverage.height
    ? defaultValue : coverage.data[py * coverage.width + px];
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
    + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

export function invertRegionTransform(matrix: RegionTransform): RegionTransform {
  if (!matrix.every(Number.isFinite)) throw new Error('区域变换必须为有限数');
  try { return inverseAffine(matrix,0); } catch { throw new Error('区域变换不可逆'); }
}
