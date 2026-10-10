/** D65 RGB 数学契约；共享 CPU/GPU、图片与时序宿主，不依赖领域文档。 */
export type RgbWorkingSpace = 'srgb' | 'display-p3' | 'rec2020';
export type RgbTransferFunction = 'srgb' | 'linear' | 'pq' | 'hlg';
export type RgbMatrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

const RGB_TO_XYZ: Record<RgbWorkingSpace, RgbMatrix3> = {
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

const XYZ_TO_RGB: Record<RgbWorkingSpace, RgbMatrix3> = {
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

/** GPU/CPU 共用的 D65 线性 RGB 原色转换矩阵（row-major）。 */
export function linearWorkingSpaceMatrixV3(
  source: RgbWorkingSpace,
  target: RgbWorkingSpace,
): RgbMatrix3 {
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
  return output as unknown as RgbMatrix3
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
  transferFunction: RgbTransferFunction,
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
  transferFunction: RgbTransferFunction,
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

