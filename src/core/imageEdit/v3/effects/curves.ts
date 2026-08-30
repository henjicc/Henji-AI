import {
  mapStraightRgbPreservingAlpha,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';

export const IMAGE_EDIT_CURVE_LUT_SIZE = 4096;

export interface CurveControlPoint {
  readonly x: number;
  readonly y: number;
}

export interface CompiledCurveLut {
  readonly values: Float32Array;
  /** 用于 [0,1] 外浮点头部空间的线性延伸，不把 HDR 值硬裁到 LUT 端点。 */
  readonly endpointSlopes: readonly [number, number];
}

export interface CurvesAdjustmentParameters {
  readonly master: readonly CurveControlPoint[];
  readonly red: readonly CurveControlPoint[];
  readonly green: readonly CurveControlPoint[];
  readonly blue: readonly CurveControlPoint[];
}

export interface CompiledCurvesAdjustment {
  readonly master: CompiledCurveLut;
  readonly red: CompiledCurveLut;
  readonly green: CompiledCurveLut;
  readonly blue: CompiledCurveLut;
}

export const CURVES_ADJUSTMENT_CONTRACT: CpuReferenceKernelContract = {
  id: 'adjustment.curves',
  version: 2,
  inputColorDomain: 'perceptual-working',
  outputColorDomain: 'perceptual-working',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

export const IDENTITY_CURVE_POINTS: readonly CurveControlPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export function compileCurvesAdjustment(
  parameters: CurvesAdjustmentParameters,
): CompiledCurvesAdjustment {
  return {
    master: compileCurveLut(parameters.master),
    red: compileCurveLut(parameters.red),
    green: compileCurveLut(parameters.green),
    blue: compileCurveLut(parameters.blue),
  };
}

/** 使用保形分段三次 Hermite 插值；单调控制点不会被插值器制造反向波纹。 */
export function compileCurveLut(
  controlPoints: readonly CurveControlPoint[],
  size = IMAGE_EDIT_CURVE_LUT_SIZE,
): CompiledCurveLut {
  if (!Number.isSafeInteger(size) || size < 2) throw new Error('曲线 LUT 至少需要 2 项');
  const points = normalizeControlPoints(controlPoints);
  const tangents = calculateMonotoneTangents(points);
  const values = new Float32Array(size);
  let segment = 0;
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1);
    while (segment < points.length - 2 && input > points[segment + 1].x) segment += 1;
    values[index] = interpolateHermite(
      points[segment],
      points[segment + 1],
      tangents[segment],
      tangents[segment + 1],
      input,
    );
  }
  values[0] = points[0].y;
  values[size - 1] = points[points.length - 1].y;
  return { values, endpointSlopes: [tangents[0], tangents[tangents.length - 1]] };
}

export function sampleCurveLut(lut: CompiledCurveLut, input: number): number {
  if (!Number.isFinite(input)) throw new Error('曲线输入必须是有限数');
  const lastIndex = lut.values.length - 1;
  if (input < 0) return lut.values[0] + input * lut.endpointSlopes[0];
  if (input > 1) return lut.values[lastIndex] + (input - 1) * lut.endpointSlopes[1];
  const position = input * lastIndex;
  const lower = Math.floor(position);
  const upper = Math.min(lastIndex, lower + 1);
  const amount = position - lower;
  return lut.values[lower] + (lut.values[upper] - lut.values[lower]) * amount;
}

/** 各通道曲线先执行，主曲线最后执行；两级都保留 Float32 头部空间。 */
export function applyCurvesAdjustment(
  tile: Float32PremultipliedRgbaTile,
  parameters: CurvesAdjustmentParameters | CompiledCurvesAdjustment,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  const curves = isCompiledCurvesAdjustment(parameters)
    ? parameters
    : compileCurvesAdjustment(parameters);
  return mapStraightRgbPreservingAlpha(
    tile,
    CURVES_ADJUSTMENT_CONTRACT.inputColorDomain,
    (red, green, blue) => [
      sampleCurveLut(curves.master, sampleCurveLut(curves.red, red)),
      sampleCurveLut(curves.master, sampleCurveLut(curves.green, green)),
      sampleCurveLut(curves.master, sampleCurveLut(curves.blue, blue)),
    ],
    options,
  );
}

function normalizeControlPoints(
  controlPoints: readonly CurveControlPoint[],
): CurveControlPoint[] {
  const points = controlPoints.map((point) => {
    if (
      !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || point.x < 0
      || point.x > 1
      || point.y < 0
      || point.y > 1
    ) throw new Error('曲线控制点必须位于 0～1');
    return { x: point.x, y: point.y };
  }).sort((left, right) => left.x - right.x);
  if (points.length === 0 || points[0].x > 0) points.unshift({ x: 0, y: 0 });
  if (points[points.length - 1].x < 1) points.push({ x: 1, y: 1 });
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].x === points[index - 1].x) {
      throw new Error('曲线控制点的输入位置不能重复');
    }
  }
  return points;
}

function calculateMonotoneTangents(points: readonly CurveControlPoint[]): number[] {
  const intervals: number[] = [];
  const slopes: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const interval = points[index + 1].x - points[index].x;
    intervals.push(interval);
    slopes.push((points[index + 1].y - points[index].y) / interval);
  }
  const tangents = new Array<number>(points.length).fill(0);
  tangents[0] = slopes[0];
  tangents[tangents.length - 1] = slopes[slopes.length - 1];
  for (let index = 1; index < tangents.length - 1; index += 1) {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) {
      tangents[index] = 0;
      continue;
    }
    const previousWeight = 2 * intervals[index] + intervals[index - 1];
    const nextWeight = intervals[index] + 2 * intervals[index - 1];
    tangents[index] = (previousWeight + nextWeight)
      / ((previousWeight / before) + (nextWeight / after));
  }
  return tangents;
}

function interpolateHermite(
  start: CurveControlPoint,
  end: CurveControlPoint,
  startTangent: number,
  endTangent: number,
  input: number,
): number {
  const interval = end.x - start.x;
  const normalized = Math.max(0, Math.min(1, (input - start.x) / interval));
  const squared = normalized * normalized;
  const cubed = squared * normalized;
  const startBasis = (2 * cubed) - (3 * squared) + 1;
  const startTangentBasis = cubed - (2 * squared) + normalized;
  const endBasis = (-2 * cubed) + (3 * squared);
  const endTangentBasis = cubed - squared;
  return startBasis * start.y
    + startTangentBasis * interval * startTangent
    + endBasis * end.y
    + endTangentBasis * interval * endTangent;
}

function isCompiledCurvesAdjustment(
  parameters: CurvesAdjustmentParameters | CompiledCurvesAdjustment,
): parameters is CompiledCurvesAdjustment {
  return 'values' in parameters.master && parameters.master.values instanceof Float32Array;
}
