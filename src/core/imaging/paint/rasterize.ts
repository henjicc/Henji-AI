import type { PaintBrush, PaintDab, PaintSurface, PaintTarget } from './contracts';
import { paintDabBounds, paintNoise } from './dabs';

export function paintDabCoverage(dab: PaintDab, brush: PaintBrush, x: number, y: number): number {
  if (dab.radius <= 0) return 0;
  const dx = x - dab.x, dy = y - dab.y;
  const cos = Math.cos(dab.angle), sin = Math.sin(dab.angle);
  const u = dx * cos + dy * sin, v = (-dx * sin + dy * cos) / dab.roundness;
  const distance = Math.hypot(u, v);
  if (brush.hardness === 1 && !brush.texture) return distance <= dab.radius ? 1 : 0;
  const inner = dab.radius * brush.hardness;
  const transition = Math.max(1, dab.radius - inner);
  const amount = Math.max(0, Math.min(1, (distance - inner + 0.5) / transition));
  let coverage = 1 - amount * amount * (3 - 2 * amount);
  if (distance > dab.radius + 0.5) coverage = 0;
  if (brush.texture) coverage *= 1 - brush.texture * paintNoise(brush.seed ?? 1, Math.floor(x), Math.floor(y));
  return coverage;
}

/** Shared pixel/mask composition. Always starts at the immutable pre-gesture pixels. */
export function compositePaintPixel(surface: PaintSurface, target: PaintTarget, tool: 'brush' | 'eraser', index: number, amount: number): boolean {
  if (surface.clip) amount *= surface.clip[index];
  const channels = target.kind === 'mask' ? 1 : 4;
  const offset = index * channels;
  const alpha = target.kind === 'rgba' ? target.color[3] : 1;
  const remaining = 1 - (tool === 'eraser' ? amount : amount * alpha);
  let changed = false;
  for (let channel = 0; channel < channels; channel++) {
    const color = tool === 'eraser' ? 0 : target.kind === 'mask' ? target.value : target.color[channel];
    const value = Math.fround(color * amount + surface.before[offset + channel] * remaining);
    changed = changed || value !== surface.output[offset + channel];
    surface.output[offset + channel] = value;
  }
  return changed;
}

export function rasterizePaintDabs(surface: PaintSurface, dabs: readonly PaintDab[], brush: PaintBrush, target: PaintTarget, tool: 'brush' | 'eraser'): boolean {
  const pixels = surface.width * surface.height;
  if (surface.coverage.length !== pixels || surface.before.length !== pixels * (target.kind === 'mask' ? 1 : 4)
    || surface.output.length !== surface.before.length || (surface.clip && surface.clip.length !== pixels)) throw new Error('绘画瓦片缓冲尺寸不匹配');
  let changed = false;
  for (const dab of dabs) {
    const bounds = paintDabBounds(dab);
    const left = Math.max(0, Math.floor(bounds.x - surface.originX)), top = Math.max(0, Math.floor(bounds.y - surface.originY));
    const right = Math.min(surface.width, Math.ceil(bounds.x + bounds.width - surface.originX));
    const bottom = Math.min(surface.height, Math.ceil(bounds.y + bounds.height - surface.originY));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = y * surface.width + x;
      const flow = paintDabCoverage(dab, brush, surface.originX + x + 0.5, surface.originY + y + 0.5) * dab.flow;
      if (flow <= 0) continue;
      surface.coverage[index] += (1 - surface.coverage[index]) * flow;
      changed = compositePaintPixel(surface, target, tool, index, surface.coverage[index] * brush.opacity) || changed;
    }
  }
  return changed;
}
