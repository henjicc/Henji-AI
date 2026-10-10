import type { EvaluationContext } from '../evaluation';

/** An immutable source-time sample in the host reference grid; linear premultiplied RGBA. */
export interface RetouchPixels {
  width: number; height: number; originX: number; originY: number; data: Float32Array;
}
export interface RetouchSource {
  mode: 'clone' | 'heal';
  offset: { x: number; y: number };
  source: RetouchPixels;
  /** Pre-stroke target, including the low-frequency neighbourhood for healing. */
  destination: RetouchPixels;
  /** Optional authoritative selection in destination's grid, excludes damaged boundary samples. */
  destinationCoverage?: Float32Array;
  healingRadius: number;
  context?: EvaluationContext;
}

export interface TextureCompletionInput {
  pixels: RetouchPixels;
  /** Authoritative float coverage, also excludes ALL selected pixels from donor search. */
  coverage: Float32Array;
  seed?: number;
  context?: EvaluationContext;
}
export interface TextureCompletionResult {
  data: Float32Array;
  /** Ring fit is a diagnostic, never a promise of semantic correctness. */
  ringError: number;
  offsets: readonly { x: number; y: number; error: number }[];
}
