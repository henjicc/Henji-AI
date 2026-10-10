import type { RegionRect, RegionGrid } from '../../regions';
import { sampleBilinearPixels } from '../resample';
import { sampleSeamCoordinate, type SeamPlan } from '.';

/** Full-resolution reads are bounded by this ROI and recursively split by the host byte budget. */
export function seamSourceRegion(plan: SeamPlan, output: RegionGrid, region: RegionRect, source: RegionGrid): RegionRect {
  let left = source.width - 1, top = source.height - 1, right = 0, bottom = 0;
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const p = sampleSeamCoordinate(plan, (region.x + x + .5) / output.width, (region.y + y + .5) / output.height);
    const sx = Math.max(0, Math.min(source.width - 1, p[0] * source.width - .5)), sy = Math.max(0, Math.min(source.height - 1, p[1] * source.height - .5));
    left = Math.min(left, Math.floor(sx)); top = Math.min(top, Math.floor(sy)); right = Math.max(right, Math.min(source.width, Math.floor(sx) + 2)); bottom = Math.max(bottom, Math.min(source.height, Math.floor(sy) + 2));
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function sampleSeamRegion(plan: SeamPlan, output: RegionGrid, region: RegionRect, source: RegionGrid,
  sourceRect: RegionRect, pixels: Float32Array, channels: 1 | 4, edge: 'clamp' | 'transparent' = 'clamp'): Float32Array {
  const data = new Float32Array(region.width * region.height * channels);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const p = sampleSeamCoordinate(plan, (region.x + x + .5) / output.width, (region.y + y + .5) / output.height);
    const rawX = p[0] * source.width - .5, rawY = p[1] * source.height - .5;
    const sx = (edge === 'clamp' ? Math.max(0, Math.min(source.width - 1, rawX)) : rawX) - sourceRect.x, sy = (edge === 'clamp' ? Math.max(0, Math.min(source.height - 1, rawY)) : rawY) - sourceRect.y;
    sampleBilinearPixels({ ...sourceRect, data: pixels }, sx, sy, channels, data, (y * region.width + x) * channels, edge);
  }
  return data;
}
export interface ProxyContribution { region: RegionRect; pixels: Float32Array; counts: Float32Array; protect: Float32Array }
export function reduceSeamAnalysisTile(data: Float32Array, region: RegionRect, source: RegionGrid, proxy: RegionGrid, coverage?: Float32Array): ProxyContribution {
  const left = Math.floor(region.x * proxy.width / source.width), top = Math.floor(region.y * proxy.height / source.height);
  const rect = { x: left, y: top, width: Math.ceil((region.x + region.width) * proxy.width / source.width) - left, height: Math.ceil((region.y + region.height) * proxy.height / source.height) - top };
  const pixels = new Float32Array(rect.width * rect.height * 4), counts = new Float32Array(rect.width * rect.height), protect = new Float32Array(counts.length);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const index = y * region.width + x, dx = Math.floor((region.x + x) * proxy.width / source.width) - rect.x, dy = Math.floor((region.y + y) * proxy.height / source.height) - rect.y, i = dy * rect.width + dx;
    counts[i]++; for (let c = 0; c < 4; c++) pixels[i * 4 + c] += data[index * 4 + c]; protect[i] = Math.max(protect[i], coverage?.[index] ?? 0);
  }
  return { region: rect, pixels, counts, protect };
}
