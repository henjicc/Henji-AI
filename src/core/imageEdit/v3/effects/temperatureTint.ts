import type { ImageEditWorkingSpaceV3 } from '../colorTypes';
import {
  assertFloat32PremultipliedRgbaTile,
  cloneFloat32Tile,
  mapStraightRgbPreservingAlpha,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';

export interface TemperatureTintAdjustmentParameters {
  /** -1 冷、0 中性、+1 暖；按 D65 附近 ±110 mired 映射到色温。 */
  readonly temperature: number;
  /** -1 偏绿、0 中性、+1 偏洋红；在 CIE 1976 u'v' 中移动白点。 */
  readonly tint: number;
  readonly workingSpace: ImageEditWorkingSpaceV3;
}

export const TEMPERATURE_TINT_ADJUSTMENT_CONTRACT: CpuReferenceKernelContract = {
  id: 'adjustment.temperature-tint',
  version: 1,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];
type Vector3 = readonly [number, number, number];

const RGB_TO_XYZ: Readonly<Record<ImageEditWorkingSpaceV3, Matrix3>> = {
  srgb: [
    0.4124564, 0.3575761, 0.1804375,
    0.2126729, 0.7151522, 0.072175,
    0.0193339, 0.119192, 0.9503041,
  ],
  'display-p3': [
    0.48657095, 0.26566769, 0.19821729,
    0.22897456, 0.69173852, 0.07928691,
    0, 0.04511338, 1.04394437,
  ],
  rec2020: [
    0.63695805, 0.1446169, 0.16888098,
    0.26270021, 0.67799807, 0.05930172,
    0, 0.02807269, 1.06098506,
  ],
};

const XYZ_TO_RGB: Readonly<Record<ImageEditWorkingSpaceV3, Matrix3>> = {
  srgb: [
    3.2404542, -1.5371385, -0.4985314,
    -0.969266, 1.8760108, 0.041556,
    0.0556434, -0.2040259, 1.0572252,
  ],
  'display-p3': [
    2.49349691, -0.93138362, -0.40271078,
    -0.82948897, 1.76266406, 0.02362469,
    0.03584583, -0.07617239, 0.95688452,
  ],
  rec2020: [
    1.71665119, -0.35567078, -0.25336628,
    -0.66668435, 1.61648124, 0.01576855,
    0.01763986, -0.04277061, 0.94210312,
  ],
};

const BRADFORD: Matrix3 = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];
const INVERSE_BRADFORD: Matrix3 = [
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867,
];
const D65_XYZ: Vector3 = [0.95045593, 1, 1.08905775];

export function applyTemperatureTintAdjustment(
  tile: Float32PremultipliedRgbaTile,
  parameters: TemperatureTintAdjustmentParameters,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  validateParameters(parameters);
  assertFloat32PremultipliedRgbaTile(
    tile,
    TEMPERATURE_TINT_ADJUSTMENT_CONTRACT.inputColorDomain,
  );
  if (parameters.temperature === 0 && parameters.tint === 0) return cloneFloat32Tile(tile);
  const targetWhite = targetWhiteXyz(parameters.temperature, parameters.tint);
  const sourceLms = multiplyMatrixVector(BRADFORD, D65_XYZ);
  const targetLms = multiplyMatrixVector(BRADFORD, targetWhite);
  const lmsScale: Vector3 = [
    targetLms[0] / sourceLms[0],
    targetLms[1] / sourceLms[1],
    targetLms[2] / sourceLms[2],
  ];
  return mapStraightRgbPreservingAlpha(
    tile,
    TEMPERATURE_TINT_ADJUSTMENT_CONTRACT.inputColorDomain,
    (red, green, blue) => {
      const xyz = multiplyMatrixVector(RGB_TO_XYZ[parameters.workingSpace], [red, green, blue]);
      const lms = multiplyMatrixVector(BRADFORD, xyz);
      const adaptedLms: Vector3 = [
        lms[0] * lmsScale[0],
        lms[1] * lmsScale[1],
        lms[2] * lmsScale[2],
      ];
      const adaptedXyz = multiplyMatrixVector(INVERSE_BRADFORD, adaptedLms);
      return multiplyMatrixVector(XYZ_TO_RGB[parameters.workingSpace], adaptedXyz);
    },
    options,
  );
}

function targetWhiteXyz(temperature: number, tint: number): Vector3 {
  const neutralMired = 1_000_000 / 6504;
  const kelvin = 1_000_000 / (neutralMired + temperature * 110);
  const chromaticity = planckianChromaticity(kelvin);
  const denominator = (-2 * chromaticity.x) + (12 * chromaticity.y) + 3;
  const u = (4 * chromaticity.x) / denominator;
  const v = (9 * chromaticity.y) / denominator - tint * 0.02;
  const uvDenominator = (6 * u) - (16 * v) + 12;
  const x = (9 * u) / uvDenominator;
  const y = (4 * v) / uvDenominator;
  return [x / y, 1, (1 - x - y) / y];
}

function planckianChromaticity(kelvin: number): { x: number; y: number } {
  const inverse = 1 / kelvin;
  const inverseSquared = inverse * inverse;
  const inverseCubed = inverseSquared * inverse;
  const x = kelvin <= 4000
    ? (-0.2661239e9 * inverseCubed) - (0.234358e6 * inverseSquared)
      + (0.8776956e3 * inverse) + 0.17991
    : (-3.0258469e9 * inverseCubed) + (2.1070379e6 * inverseSquared)
      + (0.2226347e3 * inverse) + 0.24039;
  const y = kelvin <= 2222
    ? (-1.1063814 * x ** 3) - (1.3481102 * x ** 2) + (2.18555832 * x) - 0.20219683
    : kelvin <= 4000
      ? (-0.9549476 * x ** 3) - (1.37418593 * x ** 2) + (2.09137015 * x) - 0.16748867
      : (3.081758 * x ** 3) - (5.8733867 * x ** 2) + (3.75112997 * x) - 0.37001483;
  return { x, y };
}

function multiplyMatrixVector(matrix: Matrix3, vector: Vector3): Vector3 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function validateParameters(parameters: TemperatureTintAdjustmentParameters): void {
  if (
    !Number.isFinite(parameters.temperature)
    || parameters.temperature < -1
    || parameters.temperature > 1
  ) throw new Error('色温必须位于 -1～1');
  if (!Number.isFinite(parameters.tint) || parameters.tint < -1 || parameters.tint > 1) {
    throw new Error('色调必须位于 -1～1');
  }
  if (!(parameters.workingSpace in RGB_TO_XYZ)) throw new Error('不支持的工作色域');
}
