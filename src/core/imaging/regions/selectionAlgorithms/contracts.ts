import type { Coverage, RegionEvaluationContext, RegionGrid, RegionPoint, RegionRect, RegionSnapshot } from '../contracts';

/** Straight linear-light working-space RGBA. Matching never clips HDR values. */
export interface SelectionPixels extends RegionRect { data: Float32Array }
export interface SelectionPixelSource {
  grid: RegionGrid;
  read(region: RegionRect, context: RegionEvaluationContext): SelectionPixels | Promise<SelectionPixels>;
}
export type SelectionAlgorithm =
  | { kind: 'wand'; seed: RegionPoint; tolerance: number; contiguous: boolean }
  | { kind: 'color-range'; samples: readonly RegionPoint[]; tolerance: number }
  | { kind: 'focus'; range: number; noise: number };
export type SelectionModification = 'expand' | 'contract' | 'smooth' | 'border';
export interface SelectionAlgorithmOptions {
  context: RegionEvaluationContext;
  /** Storage granularity, not a product size limit. */
  tileSize?: number;
  onProgress?: (completed: number, total: number) => void;
}
export interface SelectionCoverageSource {
  grid: RegionGrid;
  read(region: RegionRect, context: RegionEvaluationContext): Coverage | Promise<Coverage>;
}
export type SelectionAlgorithmResult = RegionSnapshot;
