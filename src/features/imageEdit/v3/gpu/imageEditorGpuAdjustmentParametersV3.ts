import { compileCurvesAdjustment, type CurveControlPoint } from '@/core/imageEdit/v3/effects'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes'

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]
type Vector3 = readonly [number, number, number]

const RGB_TO_XYZ: Matrix3 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.072175,
  0.0193339, 0.119192, 0.9503041,
]
const XYZ_TO_RGB: Matrix3 = [
  3.2404542, -1.5371385, -0.4985314,
  -0.969266, 1.8760108, 0.041556,
  0.0556434, -0.2040259, 1.0572252,
]
const BRADFORD: Matrix3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
const INVERSE_BRADFORD: Matrix3 = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867]
const D65_XYZ: Vector3 = [0.95045593, 1, 1.08905775]

export interface ImageEditorGpuCurveDataV3 {
  values: Float32Array
  slopes: Float32Array
}

export function imageEditorGpuNumberParameterV3(
  params: ImageEditJsonObjectV3,
  key: string,
  fallback: number,
): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function imageEditorGpuExposureParametersV3(params: ImageEditJsonObjectV3): readonly number[] {
  return [
    imageEditorGpuNumberParameterV3(params, 'stops', 0),
    imageEditorGpuNumberParameterV3(params, 'offset', 0),
    Math.max(Number.EPSILON, imageEditorGpuNumberParameterV3(params, 'gamma', 1)),
    0,
  ]
}

export function imageEditorGpuHslParametersV3(params: ImageEditJsonObjectV3): readonly number[] {
  return [
    imageEditorGpuNumberParameterV3(params, 'hueDegrees', 0),
    imageEditorGpuNumberParameterV3(params, 'saturation', 0),
    imageEditorGpuNumberParameterV3(params, 'lightness', 0),
    0,
  ]
}

export function imageEditorGpuTemperatureMatrixV3(params: ImageEditJsonObjectV3): Float32Array {
  const temperature = imageEditorGpuNumberParameterV3(params, 'temperature', 0)
  const tint = imageEditorGpuNumberParameterV3(params, 'tint', 0)
  const targetWhite = targetWhiteXyz(temperature, tint)
  const sourceLms = multiplyVector(BRADFORD, D65_XYZ)
  const targetLms = multiplyVector(BRADFORD, targetWhite)
  const scale: Matrix3 = [
    targetLms[0] / sourceLms[0], 0, 0,
    0, targetLms[1] / sourceLms[1], 0,
    0, 0, targetLms[2] / sourceLms[2],
  ]
  const matrix = multiplyMatrices(XYZ_TO_RGB, multiplyMatrices(INVERSE_BRADFORD,
    multiplyMatrices(scale, multiplyMatrices(BRADFORD, RGB_TO_XYZ))))
  return new Float32Array([
    matrix[0], matrix[1], matrix[2], 0,
    matrix[3], matrix[4], matrix[5], 0,
    matrix[6], matrix[7], matrix[8], 0,
  ])
}

export function imageEditorGpuCurveDataV3(params: ImageEditJsonObjectV3): ImageEditorGpuCurveDataV3 {
  const compiled = compileCurvesAdjustment({
    master: points(params.master), red: points(params.red),
    green: points(params.green), blue: points(params.blue),
  })
  const curves = [compiled.master, compiled.red, compiled.green, compiled.blue]
  const values = new Float32Array(4096 * 4)
  const slopes = new Float32Array(8)
  curves.forEach((curve, row) => {
    values.set(curve.values, row * 4096)
    slopes.set(curve.endpointSlopes, row * 2)
  })
  return { values, slopes }
}

function points(value: ImageEditJsonObjectV3[string]): CurveControlPoint[] {
  if (!Array.isArray(value)) return [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  const result: CurveControlPoint[] = []
  for (const entry of value) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)
      && typeof entry.x === 'number' && typeof entry.y === 'number') {
      result.push({ x: entry.x, y: entry.y })
    }
  }
  return result.length > 0 ? result : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
}

function targetWhiteXyz(temperature: number, tint: number): Vector3 {
  const neutralMired = 1_000_000 / 6504
  const kelvin = 1_000_000 / (neutralMired + temperature * 110)
  const chromaticity = planckianChromaticity(kelvin)
  const denominator = (-2 * chromaticity.x) + (12 * chromaticity.y) + 3
  const u = (4 * chromaticity.x) / denominator
  const v = (9 * chromaticity.y) / denominator - tint * 0.02
  const uvDenominator = (6 * u) - (16 * v) + 12
  const x = (9 * u) / uvDenominator
  const y = (4 * v) / uvDenominator
  return [x / y, 1, (1 - x - y) / y]
}

function planckianChromaticity(kelvin: number): { x: number; y: number } {
  const inverse = 1 / kelvin
  const squared = inverse * inverse
  const cubed = squared * inverse
  const x = kelvin <= 4000
    ? (-0.2661239e9 * cubed) - (0.234358e6 * squared) + (0.8776956e3 * inverse) + 0.17991
    : (-3.0258469e9 * cubed) + (2.1070379e6 * squared) + (0.2226347e3 * inverse) + 0.24039
  const y = kelvin <= 2222
    ? (-1.1063814 * x ** 3) - (1.3481102 * x ** 2) + (2.18555832 * x) - 0.20219683
    : kelvin <= 4000
      ? (-0.9549476 * x ** 3) - (1.37418593 * x ** 2) + (2.09137015 * x) - 0.16748867
      : (3.081758 * x ** 3) - (5.8733867 * x ** 2) + (3.75112997 * x) - 0.37001483
  return { x, y }
}

function multiplyVector(matrix: Matrix3, vector: Vector3): Vector3 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ]
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const value = (row: number, column: number): number => left[row * 3] * right[column]
    + left[row * 3 + 1] * right[column + 3] + left[row * 3 + 2] * right[column + 6]
  return [value(0, 0), value(0, 1), value(0, 2), value(1, 0), value(1, 1), value(1, 2), value(2, 0), value(2, 1), value(2, 2)]
}
