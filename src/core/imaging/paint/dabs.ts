import type { PaintBrush, PaintDab, PaintPoint } from './contracts';

export function validatePaintBrush(brush: PaintBrush): void {
  if (!Number.isFinite(brush.size) || brush.size <= 0) throw new Error('画笔大小必须为正有限数');
  for (const [name, value] of Object.entries({ hardness: brush.hardness, opacity: brush.opacity,
    flow: brush.flow ?? 1, smoothing: brush.smoothing ?? 0, texture: brush.texture ?? 0,
    scatter: brush.scatter ?? 0, roundness: brush.roundness ?? 1 })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`画笔 ${name} 必须位于 0～1`);
  }
  if (!Number.isFinite(brush.spacing ?? 0.15) || (brush.spacing ?? 0.15) <= 0
    || !Number.isFinite(brush.angle ?? 0) || !Number.isSafeInteger(brush.seed ?? 1)) throw new Error('画笔间距、角度或随机种子无效');
}

export function paintPressure(value: number, curve: PaintBrush['pressureCurve'] = 'linear'): number {
  return curve === 'soft' ? Math.sqrt(value) : curve === 'firm' ? value * value : value;
}

/** Integer hash: randomness is keyed by seed/index, never wall clock or tile order. */
export function paintNoise(seed: number, index: number, salt = 0): number {
  let value = (seed ^ Math.imul(index, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function point(input: PaintPoint): Required<PaintPoint> {
  const result = { ...input, pressure: input.pressure ?? 1, tiltX: input.tiltX ?? 0, tiltY: input.tiltY ?? 0 };
  if (!Object.values(result).every(Number.isFinite) || result.pressure < 0 || result.pressure > 1
    || Math.abs(result.tiltX) > 90 || Math.abs(result.tiltY) > 90) throw new Error('画笔采样坐标、压感或倾角无效');
  return result;
}

function interpolate(a: Required<PaintPoint>, b: Required<PaintPoint>, amount: number): Required<PaintPoint> {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount,
    pressure: a.pressure + (b.pressure - a.pressure) * amount,
    tiltX: a.tiltX + (b.tiltX - a.tiltX) * amount, tiltY: a.tiltY + (b.tiltY - a.tiltY) * amount };
}

/** Incremental arc-length walker: event chunking does not change the dab sequence. */
export class PaintDabGenerator {
  private position: Required<PaintPoint> | null = null;
  private lastInput: Required<PaintPoint> | null = null;
  private lastDabPoint: Required<PaintPoint> | null = null;
  private remainder = 0;
  private index = 0;
  private finished = false;
  constructor(private readonly brush: PaintBrush) { validatePaintBrush(brush); }

  append(points: readonly PaintPoint[]): PaintDab[] {
    if (this.finished) throw new Error('笔划已结束');
    const output: PaintDab[] = [];
    for (const input of points) {
      const current = point(input);
      this.lastInput = current;
      const amount = 1 - Math.min(this.brush.smoothing ?? 0, 0.95);
      const smoothed = this.position ? { ...current,
        x: this.position.x + (current.x - this.position.x) * amount,
        y: this.position.y + (current.y - this.position.y) * amount } : current;
      this.walk(smoothed, output);
    }
    return output;
  }

  finish(): PaintDab[] {
    if (this.finished) return [];
    const output: PaintDab[] = [];
    if (this.lastInput) {
      this.walk(this.lastInput, output);
      const last = this.lastDabPoint;
      if (!last || Math.hypot(last.x - this.lastInput.x, last.y - this.lastInput.y) > 1e-6
        || last.pressure !== this.lastInput.pressure) output.push(this.dab(this.lastInput));
    }
    this.finished = true;
    return output;
  }

  private walk(end: Required<PaintPoint>, output: PaintDab[]): void {
    const start = this.position;
    this.position = end;
    if (!start) { output.push(this.dab(end)); return; }
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) return;
    // At least a quarter reference pixel: sampling below this cannot add geometric detail.
    const step = Math.max(0.25, this.brush.size * (this.brush.spacing ?? 0.15));
    let distance = step - this.remainder;
    while (distance <= length + 1e-9) {
      output.push(this.dab(interpolate(start, end, Math.min(1, distance / length))));
      distance += step;
    }
    this.remainder = length - (distance - step);
  }

  private dab(p: Required<PaintPoint>): PaintDab {
    const index = this.index++;
    this.lastDabPoint = p;
    const pressure = paintPressure(p.pressure, this.brush.pressureCurve);
    const radius = this.brush.size * (this.brush.pressureSize === false ? 1 : pressure) / 2;
    const tilt = this.brush.tilt ? Math.min(1, Math.hypot(p.tiltX, p.tiltY) / 90) : 0;
    const reach = radius * (this.brush.scatter ?? 0);
    return { x: p.x + (paintNoise(this.brush.seed ?? 1, index, 1) * 2 - 1) * reach,
      y: p.y + (paintNoise(this.brush.seed ?? 1, index, 2) * 2 - 1) * reach,
      radius, flow: (this.brush.flow ?? 1) * (this.brush.pressureFlow ? pressure : 1),
      roundness: Math.max(0.05, (this.brush.roundness ?? (this.brush.tip === 'chisel' ? 0.3 : 1)) * (1 - tilt * 0.8)),
      angle: (this.brush.angle ?? 0) * Math.PI / 180 + (tilt > 0 ? Math.atan2(p.tiltY, p.tiltX) : 0), index };
  }
}

export function paintDabBounds(dab: PaintDab): { x: number; y: number; width: number; height: number } {
  const x = Math.floor(dab.x - dab.radius), y = Math.floor(dab.y - dab.radius);
  return { x, y, width: Math.ceil(dab.x + dab.radius) - x, height: Math.ceil(dab.y + dab.radius) - y };
}
