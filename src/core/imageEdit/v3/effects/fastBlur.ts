import {
  assertFloat32PremultipliedRgbaTile,
  createFloat32PremultipliedRgbaTile,
  mixProcessedWithMask,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';

export interface FastBlurV3Parameters {
  /** 目标模糊尺度，单位始终是文档/源图像素。 */
  readonly radius: number;
  /** 当前求值 mip；mip 1 的一个像素覆盖 2×2 个文档像素。 */
  readonly mip: number;
}

export interface FastBlurV3Geometry {
  readonly radiusInDocumentPixels: number;
  readonly radiusAtMip: number;
  readonly boxSizes: readonly [number, number, number];
  readonly supportAtMip: number;
  readonly localHaloAtMip: number;
  readonly requiresGlobalAnalysis: boolean;
}

export const FAST_BLUR_V3_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.fast-blur',
  version: 3,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

/** 小半径分块精确求值；超过这个邻域后切换为共享低频分析，避免 halo 随半径膨胀。 */
export const FAST_BLUR_V3_MAX_LOCAL_HALO = 48;

export function resolveFastBlurV3Geometry(
  parameters: FastBlurV3Parameters,
): FastBlurV3Geometry {
  validateParameters(parameters);
  const radiusAtMip = parameters.radius / (2 ** parameters.mip);
  const boxSizes = boxSizesForGaussian(radiusAtMip);
  const boxSupport = boxSizes.reduce((total, size) => total + (size - 1) / 2, 0);
  const supportAtMip = radiusAtMip > 0 && radiusAtMip < 1
    ? Math.ceil(3 * radiusAtMip)
    : boxSupport;
  return {
    radiusInDocumentPixels: parameters.radius,
    radiusAtMip,
    boxSizes,
    supportAtMip,
    localHaloAtMip: Math.min(FAST_BLUR_V3_MAX_LOCAL_HALO, supportAtMip),
    requiresGlobalAnalysis: supportAtMip > FAST_BLUR_V3_MAX_LOCAL_HALO,
  };
}

/**
 * 三次滑动窗口方框滤波的 CPU 后备实现。
 *
 * 三个奇数核共同近似指定 sigma；每一维使用移动和，因此每像素成本不随半径增长。
 * 小于 1px 时保留短核 Gaussian，避免滑杆起点出现一段完全没有反馈的死区。
 */
export function applyFastBlurV3(
  tile: Float32PremultipliedRgbaTile,
  parameters: FastBlurV3Parameters,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile, FAST_BLUR_V3_CONTRACT.inputColorDomain);
  const geometry = resolveFastBlurV3Geometry(parameters);
  let data: Float32Array;
  if (geometry.radiusAtMip <= 0) {
    data = new Float32Array(tile.data);
  } else if (geometry.radiusAtMip < 1) {
    data = convolveSmallGaussian(tile.data, tile.width, tile.height, geometry.radiusAtMip);
  } else {
    data = convolveThreeBoxes(tile.data, tile.width, tile.height, geometry.boxSizes);
  }
  const processed = createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    tile.colorDomain,
    data,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  );
  return mixProcessedWithMask(tile, processed, options.mask);
}

/** Kovesi/W3C 一类的三方框近高斯核宽求解；始终返回三个正奇数。 */
export function boxSizesForGaussian(sigma: number): readonly [number, number, number] {
  if (!Number.isFinite(sigma) || sigma <= 0) return [1, 1, 1];
  const count = 3;
  const ideal = Math.sqrt((12 * sigma * sigma / count) + 1);
  const lower = Math.max(1, Math.floor(ideal) % 2 === 0 ? Math.floor(ideal) - 1 : Math.floor(ideal));
  const upper = lower + 2;
  const numerator = 12 * sigma * sigma
    - count * lower * lower
    - 4 * count * lower
    - 3 * count;
  const lowerCount = Math.max(0, Math.min(count, Math.round(numerator / (-4 * lower - 4))));
  return Array.from(
    { length: count },
    (_, index) => index < lowerCount ? lower : upper,
  ) as unknown as readonly [number, number, number];
}

function convolveThreeBoxes(
  source: Float32Array<ArrayBufferLike>,
  width: number,
  height: number,
  sizes: readonly [number, number, number],
): Float32Array {
  let current = new Float32Array(source);
  let next = new Float32Array(current.length);
  const horizontal = new Float32Array(current.length);
  for (const size of sizes) {
    if (size <= 1) continue;
    const radius = (size - 1) / 2;
    boxBlurHorizontal(current, horizontal, width, height, radius);
    boxBlurVertical(horizontal, next, width, height, radius);
    const previous = current;
    current = next;
    next = previous;
  }
  return current;
}

function boxBlurHorizontal(
  source: Float32Array,
  destination: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const divisor = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += source[(y * width + clamp(offset, 0, width - 1)) * 4 + channel];
      }
      for (let x = 0; x < width; x += 1) {
        destination[(y * width + x) * 4 + channel] = sum / divisor;
        const removeX = clamp(x - radius, 0, width - 1);
        const addX = clamp(x + radius + 1, 0, width - 1);
        sum += source[(y * width + addX) * 4 + channel]
          - source[(y * width + removeX) * 4 + channel];
      }
    }
  }
}

function boxBlurVertical(
  source: Float32Array,
  destination: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const divisor = radius * 2 + 1;
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += source[(clamp(offset, 0, height - 1) * width + x) * 4 + channel];
      }
      for (let y = 0; y < height; y += 1) {
        destination[(y * width + x) * 4 + channel] = sum / divisor;
        const removeY = clamp(y - radius, 0, height - 1);
        const addY = clamp(y + radius + 1, 0, height - 1);
        sum += source[(addY * width + x) * 4 + channel]
          - source[(removeY * width + x) * 4 + channel];
      }
    }
  }
}

function convolveSmallGaussian(
  source: Float32Array<ArrayBufferLike>,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= total;
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let tap = -radius; tap <= radius; tap += 1) {
        const sourceOffset = (y * width + clamp(x + tap, 0, width - 1)) * 4;
        const targetOffset = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          horizontal[targetOffset + channel] += source[sourceOffset + channel] * kernel[tap + radius];
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let tap = -radius; tap <= radius; tap += 1) {
        const sourceOffset = (clamp(y + tap, 0, height - 1) * width + x) * 4;
        const targetOffset = (y * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          output[targetOffset + channel] += horizontal[sourceOffset + channel] * kernel[tap + radius];
        }
      }
    }
  }
  return output;
}

function validateParameters(parameters: FastBlurV3Parameters): void {
  if (!Number.isFinite(parameters.radius) || parameters.radius < 0) {
    throw new Error('模糊半径必须是大于等于 0 的有限数');
  }
  if (!Number.isFinite(parameters.mip) || parameters.mip < 0) {
    throw new Error('模糊 mip 必须是大于等于 0 的有限数');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
