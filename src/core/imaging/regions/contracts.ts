/** All region values are linear Float32 coverage, independent of image/video hosts. */
export interface RegionPoint { x: number; y: number }
export interface RegionGrid { width: number; height: number }
export interface RegionRect extends RegionGrid { x: number; y: number }
export type RegionTransform = readonly [number, number, number, number, number, number];
export type RegionGeometry =
  | { type: 'rectangle'; x: number; y: number; width: number; height: number }
  | { type: 'ellipse'; x: number; y: number; width: number; height: number }
  | { type: 'lasso'; points: readonly RegionPoint[] };
export const REGION_AA_SAMPLES_PER_AXIS = 4;
export type RegionCombine = 'replace' | 'add' | 'subtract' | 'intersect' | 'paint' | 'erase';
/** Geometry is normalized to the reference grid; brush radius is relative to its short edge. */
export type RegionIntent = RegionGeometry
  | { type: 'brush'; points: readonly RegionPoint[]; radius: number }
  | { type: 'mask'; width: number; height: number; matrix: RegionTransform; runs: readonly (readonly [number, number, number])[] };
export interface RegionOperation { shape: RegionIntent; combine: RegionCombine; invertBefore?: boolean; opacity?: number }
export interface RegionProgram { operations: readonly RegionOperation[]; feather: number; inverted: boolean }
export interface Coverage extends RegionRect { data: Float32Array }
/** Rational source ticks: the host resolves speed, trim and reverse before calling the kernel. */
export type RegionSampleTime = { kind: 'static' } | { kind: 'frame'; ticks: number; timeBase: readonly [number, number]; frameId: string };
export interface RegionEvaluationContext {
  sourceVersion: string;
  time: RegionSampleTime;
  referenceGrid: RegionGrid;
  quality: 'interactive' | 'final';
  signal?: AbortSignal;
}
export interface RegionSource {
  defaultValue: number | ((context: RegionEvaluationContext) => number);
  /** Tracking providers must reject missing frames instead of returning a previous frame's matte. */
  read(region: RegionRect, context: RegionEvaluationContext): Coverage | Promise<Coverage>;
}
/** Region-only port; the full color/resource EvaluationContext stays owned by evaluation task 06. */
export interface RegionFeatherPort {
  support(radius: number): number;
  apply(data: Float32Array, grid: RegionGrid, radius: number): Float32Array;
}
export interface RegionSnapshot {
  grid: RegionGrid;
  tileSize: number;
  defaultValue: number;
  inverted: boolean;
  tiles: ReadonlyMap<string, Coverage>;
}
export type RegionEditTarget = { kind: 'pixels'; layerId: string } | { kind: 'mask'; layerId: string; maskId: string };
