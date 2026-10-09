import type { PaintSurface, PaintTarget } from '../contracts';
import { compositePaintPixel } from '../rasterize';

export interface GradientStop { position: number; color: readonly [number, number, number, number] }
export type PaintFill = { kind: 'solid'; target: PaintTarget }
  | { kind: 'linear' | 'radial'; start: { x: number; y: number }; end: { x: number; y: number }; stops: readonly GradientStop[] };

export function validatePaintFill(fill: PaintFill): void {
  if (fill.kind === 'solid') {
    const values = fill.target.kind === 'mask' ? [fill.target.value] : fill.target.color;
    if (!values.every(Number.isFinite) || (fill.target.kind === 'mask' && (fill.target.value < 0 || fill.target.value > 1))) throw new Error('填充颜色或蒙版值无效');
    if (fill.target.kind === 'rgba' && (fill.target.color[3] < 0 || fill.target.color[3] > 1
      || (fill.target.color[3] === 0 && fill.target.color.slice(0, 3).some(v => v !== 0)))) throw new Error('填充需要有效的预乘颜色');
    return;
  }
  if (![fill.start.x, fill.start.y, fill.end.x, fill.end.y].every(Number.isFinite)
    || Math.hypot(fill.end.x - fill.start.x, fill.end.y - fill.start.y) === 0) throw new Error('请拖出渐变范围');
  if (fill.stops.length < 2) throw new Error('渐变至少需要两个色标');
  let position = -1;
  for (const stop of fill.stops) {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1 || stop.position < position) throw new Error('渐变色标必须按 0～1 位置排序');
    validatePaintFill({ kind: 'solid', target: { kind: 'rgba', color: stop.color } });
    position = stop.position;
  }
}

/** Interpolates premultiplied values in the host's linear working space, preserving HDR. */
export function samplePaintGradient(fill: Exclude<PaintFill, { kind: 'solid' }>, x: number, y: number): readonly [number, number, number, number] {
  const dx = fill.end.x - fill.start.x, dy = fill.end.y - fill.start.y;
  const length = Math.hypot(dx, dy);
  const t = Math.max(0, Math.min(1, fill.kind === 'radial'
    ? Math.hypot(x - fill.start.x, y - fill.start.y) / length
    : ((x - fill.start.x) * dx + (y - fill.start.y) * dy) / (length * length)));
  const upper = fill.stops.findIndex(stop => stop.position >= t);
  if (upper <= 0) return fill.stops[upper === -1 ? fill.stops.length - 1 : 0].color;
  const a = fill.stops[upper - 1], b = fill.stops[upper];
  const amount = b.position === a.position ? 1 : (t - a.position) / (b.position - a.position);
  return [0, 1, 2, 3].map(channel => a.color[channel] + (b.color[channel] - a.color[channel]) * amount) as [number, number, number, number];
}

export function rasterizePaintFill(surface: PaintSurface, fill: PaintFill, opacity: number, mask: boolean, signal?: AbortSignal): boolean {
  validatePaintFill(fill);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('填充不透明度必须位于 0～1');
  const channels = mask ? 1 : 4;
  if (surface.before.length !== surface.width * surface.height * channels || surface.output.length !== surface.before.length
    || (surface.clip && surface.clip.length !== surface.width * surface.height)) throw new Error('填充瓦片尺寸不匹配');
  if (fill.kind === 'solid' && (fill.target.kind === 'mask') !== mask) throw new Error('填充目标类型不匹配');
  if (mask && fill.kind !== 'solid' && fill.stops.some(stop => stop.color[0] < 0 || stop.color[0] > 1)) throw new Error('蒙版渐变值必须位于 0～1');
  let changed = false;
  for (let y = 0; y < surface.height; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < surface.width; x++) {
      const color = fill.kind === 'solid' ? null : samplePaintGradient(fill, surface.originX + x + 0.5, surface.originY + y + 0.5);
      const target: PaintTarget = fill.kind === 'solid' ? fill.target : mask
        ? { kind: 'mask', value: color![0] } : { kind: 'rgba', color: color! };
      changed = compositePaintPixel(surface, target, 'brush', y * surface.width + x, opacity) || changed;
    }
  }
  return changed;
}
