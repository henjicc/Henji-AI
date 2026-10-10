import { paintDabBounds, paintDabCoverage, type PaintBrush, type PaintDab, type PaintSurface } from '../paint';
import { evaluationCacheIdentity } from '../evaluation';
import type { RetouchPixels, RetouchSource } from './contracts';
import { solveRetouchMembrane } from './poisson';

export function assertRetouchPixels(pixels: RetouchPixels): void {
  if (!Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width < 1 || pixels.height < 1
    || !Number.isSafeInteger(pixels.originX) || !Number.isSafeInteger(pixels.originY)
    || pixels.data.length !== pixels.width * pixels.height * 4) throw new Error('修饰来源缓冲尺寸不匹配');
}

/** Transparent outside the source; never stretch an edge pixel into an absent donor. */
export function sampleRetouchPixel(pixels: RetouchPixels, x: number, y: number, channel: number): number {
  const px = x - pixels.originX, py = y - pixels.originY, ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const at = (dx: number, dy: number): number => dx >= 0 && dy >= 0 && dx < pixels.width && dy < pixels.height
    ? pixels.data[(dy * pixels.width + dx) * 4 + channel] : 0;
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
    + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

/** A dab-local Poisson paint image is immutable: independent of event batches and tile boundaries.
 * The selection, when supplied, defines damaged samples and must not enter the Dirichlet boundary. */
function healDab(source: RetouchSource, dab: PaintDab, brush: PaintBrush): RetouchPixels {
  const destination = source.destination, bounds = paintDabBounds(dab), margin = Math.max(2, source.healingRadius);
  const left = Math.max(destination.originX, Math.floor(bounds.x) - margin), top = Math.max(destination.originY, Math.floor(bounds.y) - margin);
  const right = Math.min(destination.originX + destination.width, Math.ceil(bounds.x + bounds.width) + margin);
  const bottom = Math.min(destination.originY + destination.height, Math.ceil(bounds.y + bounds.height) + margin);
  const width = right - left, height = bottom - top, data = new Float32Array(width * height * 4), donor = new Float32Array(width * height * 3), unknown = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, gx = left + x, gy = top + y;
    const alpha = sampleRetouchPixel(destination, gx, gy, 3), sa = sampleRetouchPixel(source.source, gx + source.offset.x, gy + source.offset.y, 3);
    const selected = source.destinationCoverage?.[(gy - destination.originY) * destination.width + gx - destination.originX];
    unknown[i] = Number(alpha > 0 && sa > 0 && (selected !== undefined ? selected > 0 : paintDabCoverage(dab, brush, gx + .5, gy + .5) > 0));
    for (let c = 0; c < 3; c++) {
      donor[i * 3 + c] = sa > 0 ? sampleRetouchPixel(source.source, gx + source.offset.x, gy + source.offset.y, c) / sa : 0;
      data[i * 4 + c] = alpha > 0 ? sampleRetouchPixel(destination, gx, gy, c) / alpha : 0;
    }
    data[i * 4 + 3] = alpha;
  }
  for (let c = 0; c < 3; c++) {
    const membrane = new Float32Array(width * height);
    for (let i = 0; i < membrane.length; i++) membrane[i] = unknown[i] ? 0 : data[i * 4 + c] - donor[i * 3 + c];
    solveRetouchMembrane(width, height, unknown, membrane);
    for (let i = 0; i < membrane.length; i++) data[i * 4 + c] = (unknown[i] ? donor[i * 3 + c] + membrane[i] : data[i * 4 + c]) * data[i * 4 + 3];
  }
  return { width, height, originX: left, originY: top, data };
}

/** Same dabs/flow/opacity/selection as paint; all sampling stays at the pre-stroke source. */
export function rasterizeRetouchDabs(surface: PaintSurface, dabs: readonly PaintDab[], brush: PaintBrush, source: RetouchSource): boolean {
  assertRetouchPixels(source.source); assertRetouchPixels(source.destination);
  if (source.context) { source.context.signal?.throwIfAborted(); evaluationCacheIdentity(source.context); }
  if (!Number.isFinite(source.offset.x) || !Number.isFinite(source.offset.y) || !Number.isSafeInteger(source.healingRadius) || source.healingRadius < 0) throw new Error('修饰来源位置或融合半径无效');
  const count = surface.width * surface.height;
  if (surface.before.length !== count * 4 || surface.output.length !== count * 4 || surface.coverage.length !== count || (surface.clip && surface.clip.length !== count)) throw new Error('修饰目标缓冲尺寸不匹配');
  if (source.destinationCoverage && source.destinationCoverage.length !== source.destination.width * source.destination.height) throw new Error('修复边界覆盖尺寸无效');
  let changed = false;
  for (const dab of dabs) {
    const bounds = paintDabBounds(dab), left = Math.max(0, Math.floor(bounds.x - surface.originX)), top = Math.max(0, Math.floor(bounds.y - surface.originY));
    const right = Math.min(surface.width, Math.ceil(bounds.x + bounds.width - surface.originX)), bottom = Math.min(surface.height, Math.ceil(bounds.y + bounds.height - surface.originY));
    if (left >= right || top >= bottom) continue;
    const healed = source.mode === 'heal' ? healDab(source, dab, brush) : null;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = y * surface.width + x, gx = surface.originX + x, gy = surface.originY + y;
      const flow = paintDabCoverage(dab, brush, gx + .5, gy + .5) * dab.flow;
      if (flow <= 0) continue;
      const sx = gx + source.offset.x, sy = gy + source.offset.y;
      const sa = sampleRetouchPixel(source.source, sx, sy, 3);
      if (sa <= 0) continue;
      surface.coverage[index] += (1 - surface.coverage[index]) * flow;
      const amount = surface.coverage[index] * brush.opacity * (surface.clip?.[index] ?? 1), to = index * 4;
      const da = surface.before[to + 3], alpha = source.mode === 'heal' ? da : sa + da * (1 - sa);
      for (let c = 0; c < 4; c++) {
        let paint = sa;
        if (c < 3) {
          paint = sampleRetouchPixel(source.source, sx, sy, c);
          if (healed) paint = sampleRetouchPixel(healed, gx, gy, c);
          else paint += surface.before[to + c] * (1 - sa);
        } else paint = alpha;
        const value = Math.fround(surface.before[to + c] + (paint - surface.before[to + c]) * amount);
        changed = value !== surface.output[to + c] || changed; surface.output[to + c] = value;
      }
    }
  }
  return changed;
}
