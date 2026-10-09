import type { RegionIntent, RegionProgram, RegionRect, RegionGrid, RegionFeatherPort } from './contracts';
import { rasterizeRegionGeometry } from './rasterize';
import { assertRegionRect, combineRegionCoverage, invertRegionTransform, throwIfRegionAborted } from './coverage';

function requireFeather(port?: RegionFeatherPort): RegionFeatherPort {
  if (!port) throw new Error('羽化求值需要宿主提供共享模糊端口');
  return port;
}

export function rasterizeRegionIntent(shape: RegionIntent, size: { width: number; height: number }, region: RegionRect): Float32Array {
  if (shape.type === 'mask') {
    invertRegionTransform(shape.matrix);
    const [a, b, c, d, e, f] = shape.matrix, determinant = a * d - b * c
    const result = new Float32Array(region.width * region.height)
    const at = (x: number, y: number): number => {
      const index = Math.max(0, Math.min(shape.height - 1, y)) * shape.width + Math.max(0, Math.min(shape.width - 1, x))
      let low = 0, high = shape.runs.length - 1
      while (low <= high) { const middle = Math.floor((low + high) / 2), [start, length, value] = shape.runs[middle]; if (index < start) high = middle - 1; else if (index >= start + length) low = middle + 1; else return value }
      return 0
    }
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const dx = (region.x + x + 0.5) / size.width - e, dy = (region.y + y + 0.5) / size.height - f
      const nx = (d * dx - c * dy) / determinant, ny = (-b * dx + a * dy) / determinant
      if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) continue
      const sx = nx * shape.width - 0.5, sy = ny * shape.height - 0.5, ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy
      result[y * region.width + x] = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
    }
    return result
  }
  if (shape.type !== 'brush') {
    const pixels = shape.type === 'lasso'
      ? { type: 'lasso' as const, points: shape.points.map(p => ({ x: p.x * size.width, y: p.y * size.height })) }
      : { ...shape, x: shape.x * size.width, y: shape.y * size.height, width: shape.width * size.width, height: shape.height * size.height };
    return rasterizeRegionGeometry(region.width, region.height, region.x, region.y, pixels);
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
export function evaluateRegionProgram(selection: RegionProgram, size: RegionGrid, region: RegionRect, feather?: RegionFeatherPort, signal?: AbortSignal): Float32Array {
  assertRegionRect(region);
  throwIfRegionAborted(signal);
  if (![size.width, size.height].every(value => Number.isFinite(value) && value > 0)
    || !Number.isFinite(selection.feather) || selection.feather < 0 || selection.feather > 1) throw new Error('区域参考尺寸或羽化无效');
  const radius = selection.feather * Math.min(size.width, size.height);
  // 大羽化沿共享 fast-blur 的低频策略：全局对齐的 mip，halo 不随大图线性膨胀。
  if (radius > 16) {
    const scale = 2 ** Math.ceil(Math.log2(radius / 16));
    const x = Math.floor(region.x / scale) - 1, y = Math.floor(region.y / scale) - 1;
    const lowRegion = { x, y, width: Math.ceil((region.x + region.width) / scale) - x + 1, height: Math.ceil((region.y + region.height) / scale) - y + 1 };
    const low = evaluateRegionProgram(selection, { width: size.width / scale, height: size.height / scale }, lowRegion, feather, signal);
    const sample = (sx: number, sy: number) => low[Math.max(0, Math.min(lowRegion.height - 1, sy)) * lowRegion.width + Math.max(0, Math.min(lowRegion.width - 1, sx))];
    const output = new Float32Array(region.width * region.height);
    for (let py = 0; py < region.height; py++) for (let px = 0; px < region.width; px++) {
      if (region.x + px < 0 || region.y + py < 0 || region.x + px >= size.width || region.y + py >= size.height) continue;
      const sx = (region.x + px + 0.5) / scale - x - 0.5, sy = (region.y + py + 0.5) / scale - y - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy;
      output[py * region.width + px] = (sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx) * (1 - ty) + (sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx) * ty;
    }
    return output;
  }
  const halo = radius > 0 ? requireFeather(feather).support(radius) : 0;
  const expanded = { x: region.x - halo, y: region.y - halo, width: region.width + halo * 2, height: region.height + halo * 2 };
  let coverage: Float32Array = new Float32Array(expanded.width * expanded.height);
  for (const operation of selection.operations) {
    throwIfRegionAborted(signal);
    if (!Number.isFinite(operation.opacity ?? 1) || (operation.opacity ?? 1) < 0 || (operation.opacity ?? 1) > 1) throw new Error('区域覆盖强度必须为 0..1');
    const incoming = rasterizeRegionIntent(operation.shape, size, expanded);
    for (let i = 0; i < coverage.length; i++) {
      const old = operation.invertBefore ? 1 - coverage[i] : coverage[i], next = incoming[i];
      coverage[i] = combineRegionCoverage(old, next * (operation.opacity ?? 1), operation.combine);
    }
  }
  // 文档外是零覆盖；反选仅在文档内生效。
  for (let y = 0; y < expanded.height; y++) for (let x = 0; x < expanded.width; x++) {
    const i = y * expanded.width + x;
    if (selection.inverted) coverage[i] = 1 - coverage[i];
    if (expanded.x + x < 0 || expanded.y + y < 0 || expanded.x + x >= size.width || expanded.y + y >= size.height) coverage[i] = 0;
  }
  if (radius > 0) {
    coverage = requireFeather(feather).apply(coverage, expanded, radius);
  }
  const result = new Float32Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) result.set(coverage.subarray((y + halo) * expanded.width + halo, (y + halo) * expanded.width + halo + region.width), y * region.width);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    if (region.x + x < 0 || region.y + y < 0 || region.x + x >= size.width || region.y + y >= size.height) result[y * region.width + x] = 0;
  }
  return result;
}

