import type { ImageEditTransferFunctionV3, ImageEditWorkingSpaceV3 } from '../colorTypes';
import type { ImageEditColorDomain } from '../renderNodeDefinition';
import {
  createFloat32PremultipliedRgbaTile,
  type Float32PremultipliedRgbaTile,
} from '../effects/contracts';

export type ImageEditColorMatrix3V3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

const RGB_TO_XYZ: Record<ImageEditWorkingSpaceV3, ImageEditColorMatrix3V3> = {
  srgb: [
    0.4123907993, 0.3575843394, 0.1804807884,
    0.2126390059, 0.7151686788, 0.0721923154,
    0.0193308187, 0.1191947798, 0.9505321522,
  ],
  'display-p3': [
    0.4865709486, 0.2656676932, 0.1982172852,
    0.2289745641, 0.6917385218, 0.0792869141,
    0, 0.0451133819, 1.0439443689,
  ],
  rec2020: [
    0.6369580483, 0.1446169036, 0.1688809752,
    0.262700212, 0.6779980715, 0.0593017165,
    0, 0.028072693, 1.0609850577,
  ],
};

const XYZ_TO_RGB: Record<ImageEditWorkingSpaceV3, ImageEditColorMatrix3V3> = {
  srgb: [
    3.2409699419, -1.5373831776, -0.4986107603,
    -0.9692436363, 1.8759675015, 0.0415550574,
    0.0556300797, -0.2039769589, 1.0569715142,
  ],
  'display-p3': [
    2.4934969119, -0.9313836179, -0.4027107845,
    -0.8294889696, 1.7626640603, 0.0236246858,
    0.0358458302, -0.0761723893, 0.956884524,
  ],
  rec2020: [
    1.716651188, -0.3556707838, -0.2533662814,
    -0.6666843518, 1.6164812366, 0.0157685458,
    0.0176398574, -0.0427706133, 0.9421031212,
  ],
};

const PQ_M1 = 2610 / 16384;
const PQ_M2 = 2523 / 32;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = 2413 / 128;
const PQ_C3 = 2392 / 128;
const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

function multiply(
  matrix: ImageEditColorMatrix3V3,
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  return [
    matrix[0] * red + matrix[1] * green + matrix[2] * blue,
    matrix[3] * red + matrix[4] * green + matrix[5] * blue,
    matrix[6] * red + matrix[7] * green + matrix[8] * blue,
  ];
}

/** GPU/CPU 共用的 D65 线性 RGB 原色转换矩阵（row-major）。 */
export function linearWorkingSpaceMatrixV3(
  source: ImageEditWorkingSpaceV3,
  target: ImageEditWorkingSpaceV3,
): ImageEditColorMatrix3V3 {
  if (source === target) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const left = XYZ_TO_RGB[target]
  const right = RGB_TO_XYZ[source]
  const output = new Array<number>(9)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      output[row * 3 + column] = left[row * 3] * right[column]
        + left[row * 3 + 1] * right[3 + column]
        + left[row * 3 + 2] * right[6 + column]
    }
  }
  return output as unknown as ImageEditColorMatrix3V3
}

/** sRGB 扩展传递函数保留负值和 HDR 头部空间，不在转换边界裁切。 */
export function decodeSrgbExtended(value: number): number {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.04045
    ? magnitude / 12.92
    : ((magnitude + 0.055) / 1.055) ** 2.4);
}

export function encodeSrgbExtended(value: number): number {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);
  return sign * (magnitude <= 0.0031308
    ? 12.92 * magnitude
    : 1.055 * (magnitude ** (1 / 2.4)) - 0.055);
}

/** PQ 返回以 referenceWhiteNits 为 1.0 的绝对线性亮度；HLG 返回相对场景线性值。 */
export function decodeTransferFunctionV3(
  value: number,
  transferFunction: ImageEditTransferFunctionV3,
  referenceWhiteNits = 203,
): number {
  if (!Number.isFinite(value)) throw new Error('传递函数输入必须为有限数');
  if (!Number.isFinite(referenceWhiteNits) || referenceWhiteNits <= 0) throw new Error('参考白亮度无效');
  if (transferFunction === 'linear') return value;
  if (transferFunction === 'srgb') return decodeSrgbExtended(value);
  const encoded = Math.max(0, Math.min(1, value));
  if (transferFunction === 'pq') {
    const power = encoded ** (1 / PQ_M2);
    const denominator = PQ_C2 - PQ_C3 * power;
    const normalizedNits = denominator <= 0
      ? 1
      : (Math.max(power - PQ_C1, 0) / denominator) ** (1 / PQ_M1);
    return normalizedNits * 10_000 / referenceWhiteNits;
  }
  return encoded <= 0.5
    ? (encoded * encoded) / 3
    : (Math.exp((encoded - HLG_C) / HLG_A) + HLG_B) / 12;
}

export function encodeTransferFunctionV3(
  value: number,
  transferFunction: ImageEditTransferFunctionV3,
  referenceWhiteNits = 203,
): number {
  if (!Number.isFinite(value)) throw new Error('传递函数输入必须为有限数');
  if (!Number.isFinite(referenceWhiteNits) || referenceWhiteNits <= 0) throw new Error('参考白亮度无效');
  if (transferFunction === 'linear') return value;
  if (transferFunction === 'srgb') return encodeSrgbExtended(value);
  const linear = Math.max(0, value);
  if (transferFunction === 'pq') {
    const normalizedNits = Math.min(1, linear * referenceWhiteNits / 10_000);
    const power = normalizedNits ** PQ_M1;
    return ((PQ_C1 + PQ_C2 * power) / (1 + PQ_C3 * power)) ** PQ_M2;
  }
  return linear <= 1 / 12
    ? Math.sqrt(3 * linear)
    : HLG_A * Math.log(12 * linear - HLG_B) + HLG_C;
}

export function convertFloat32TileColorDomainV3(
  tile: Float32PremultipliedRgbaTile,
  target: ImageEditColorDomain,
): Float32PremultipliedRgbaTile {
  if (tile.colorDomain === target) return tile;
  const sourceIsLinear = tile.colorDomain === 'linear-light';
  const targetIsLinear = target === 'linear-light';
  if (sourceIsLinear === targetIsLinear) {
    return createFloat32PremultipliedRgbaTile(
      tile.width, tile.height, target, new Float32Array(tile.data), tile.workingSpace,
      tile.transferFunction, tile.referenceWhiteNits,
    );
  }
  const data = new Float32Array(tile.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = tile.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const straight = tile.data[offset + channel] / alpha;
      const converted = targetIsLinear
        ? decodeTransferFunctionV3(straight, tile.transferFunction, tile.referenceWhiteNits)
        : encodeTransferFunctionV3(straight, tile.transferFunction, tile.referenceWhiteNits);
      data[offset + channel] = converted * alpha;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, target, data, tile.workingSpace,
    tile.transferFunction, tile.referenceWhiteNits,
  );
}

/** 线性 D65 RGB 原色转换；不裁切负值或超白，确保 16 位/HDR 中间结果可逆。 */
export function convertFloat32TileWorkingSpaceV3(
  tile: Float32PremultipliedRgbaTile,
  target: ImageEditWorkingSpaceV3,
): Float32PremultipliedRgbaTile {
  if (tile.workingSpace === target) return tile;
  const originalDomain = tile.colorDomain;
  const linear = convertFloat32TileColorDomainV3(tile, 'linear-light');
  const data = new Float32Array(linear.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = linear.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    const xyz = multiply(
      RGB_TO_XYZ[linear.workingSpace],
      linear.data[offset] / alpha,
      linear.data[offset + 1] / alpha,
      linear.data[offset + 2] / alpha,
    );
    const converted = multiply(XYZ_TO_RGB[target], xyz[0], xyz[1], xyz[2]);
    data[offset] = converted[0] * alpha;
    data[offset + 1] = converted[1] * alpha;
    data[offset + 2] = converted[2] * alpha;
  }
  const targetLinear = createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, 'linear-light', data, target,
    tile.transferFunction, tile.referenceWhiteNits,
  );
  return convertFloat32TileColorDomainV3(targetLinear, originalDomain);
}

/** HDR/宽色域到普通屏幕的明确显示变换；仅生成预览，绝不修改权威像素。 */
export function toneMapFloat32TileToSdrV3(
  tile: Float32PremultipliedRgbaTile,
  target: Extract<ImageEditWorkingSpaceV3, 'srgb' | 'display-p3'> = 'srgb',
): Float32PremultipliedRgbaTile {
  const converted = convertFloat32TileWorkingSpaceV3(
    convertFloat32TileColorDomainV3(tile, 'linear-light'),
    target,
  );
  const data = new Float32Array(converted.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = converted.data[offset + 3];
    data[offset + 3] = alpha;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Math.max(0, converted.data[offset + channel] / alpha);
      const mapped = Math.min(1, Math.max(0, (value * (2.51 * value + 0.03))
        / (value * (2.43 * value + 0.59) + 0.14)));
      data[offset + channel] = encodeSrgbExtended(mapped) * alpha;
    }
  }
  return createFloat32PremultipliedRgbaTile(
    tile.width, tile.height, 'perceptual-working', data, target, 'srgb', 203,
  );
}
