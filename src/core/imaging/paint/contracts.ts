import type { EvaluationContext } from '../evaluation';

export interface PaintPoint {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
}

/** Coordinates and size are in the host's reference grid, never viewport pixels. */
export interface PaintBrush {
  size: number;
  hardness: number;
  opacity: number;
  flow?: number;
  spacing?: number;
  smoothing?: number;
  pressureSize?: boolean;
  pressureFlow?: boolean;
  pressureCurve?: 'linear' | 'soft' | 'firm';
  tip?: 'round' | 'chisel';
  roundness?: number;
  angle?: number;
  tilt?: boolean;
  texture?: number;
  scatter?: number;
  seed?: number;
}

export interface PaintDab {
  x: number; y: number; radius: number; flow: number;
  roundness: number; angle: number; index: number;
}

export type PaintTarget = { kind: 'mask'; value: number }
  | { kind: 'rgba'; color: readonly [number, number, number, number] };

export interface PaintSurface {
  width: number; height: number; originX: number; originY: number;
  /** Immutable pixels before this gesture; linear premultiplied RGBA or coverage. */
  before: Float32Array;
  output: Float32Array;
  /** Per-stroke flow accumulation, independent of output and opacity. */
  coverage: Float32Array;
  clip?: Float32Array;
}

/** Hosts resolve time/animation/tracking before evaluating; static pictures use static time. */
export interface PaintReplay {
  brush: PaintBrush;
  points: readonly PaintPoint[];
  tool: 'brush' | 'eraser';
  context?: EvaluationContext;
}
