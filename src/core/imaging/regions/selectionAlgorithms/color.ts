import type { RegionPoint } from '../contracts';

export function validateTolerance(tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error('颜色容差必须为 0 到 1');
}
export function pixelPoint(point: RegionPoint, grid: { width: number; height: number }): RegionPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
    || point.x >= grid.width || point.y >= grid.height) throw new Error('取样点超出当前图层');
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
}
/** PhotoCraft per-channel maximum distance, adapted to linear float working-space units. */
export function colorDistance(a: readonly number[], b: readonly number[], includeAlpha: boolean): number {
  let distance = 0;
  for (let c = 0; c < (includeAlpha ? 4 : 3); c++) distance = Math.max(distance, Math.abs(a[c] - b[c]));
  return distance;
}
