import {
  createFloat32PremultipliedRgbaTile,
  mixProcessedWithMask,
  type CpuReferenceKernelContract,
  type Float32PremultipliedRgbaTile,
  type Float32TileProcessOptions,
} from './contracts';
import { assertFloat32PremultipliedRgbaTile } from './contracts';

export interface GaussianBlurV2Parameters {
  /** Gaussian sigma，单位始终是文档/源图像素。 */
  readonly radius: number;
  /** 当前瓦片 mip；mip 1 的每个像素覆盖 2×2 个文档像素。 */
  readonly mip: number;
  /** 大半径时每级 2× 金字塔允许保留的最大 sigma。 */
  readonly pyramidTargetRadius?: number;
}

export interface GaussianBlurV2Geometry {
  readonly radiusInDocumentPixels: number;
  readonly radiusAtMip: number;
  readonly haloInDocumentPixels: number;
  readonly haloAtMip: number;
  readonly pyramidLevel: number;
  readonly radiusAtPyramidLevel: number;
}

export const GAUSSIAN_BLUR_V2_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.gaussian-blur',
  version: 2,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

export const LEGACY_GAUSSIAN_BLUR_V1_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.blur-v1',
  version: 1,
  inputColorDomain: 'perceptual-working',
  outputColorDomain: 'perceptual-working',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

const DEFAULT_PYRAMID_TARGET_RADIUS = 16;

export function resolveGaussianBlurV2Geometry(
  parameters: GaussianBlurV2Parameters,
): GaussianBlurV2Geometry {
  validateGaussianParameters(parameters);
  const radiusAtMip = parameters.radius / (2 ** parameters.mip);
  const target = parameters.pyramidTargetRadius ?? DEFAULT_PYRAMID_TARGET_RADIUS;
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('Gaussian 金字塔目标半径必须大于 0');
  }
  const pyramidLevel = radiusAtMip <= target
    ? 0
    : Math.ceil(Math.log2(radiusAtMip / target));
  return {
    radiusInDocumentPixels: parameters.radius,
    radiusAtMip,
    haloInDocumentPixels: Math.ceil(3 * parameters.radius),
    haloAtMip: Math.ceil(3 * radiusAtMip),
    pyramidLevel,
    radiusAtPyramidLevel: radiusAtMip / (2 ** pyramidLevel),
  };
}

/**
 * Float32 预乘 RGBA 的 CPU 参考实现。
 *
 * 输入应包含规划器请求的 halo；本函数只处理传入区域，图片外缘按 clamp 采样。
 * 大半径先构建 2× 金字塔再做可分离 Gaussian，避免核宽随源图半径无限增长。
 */
export function applyGaussianBlurV2(
  tile: Float32PremultipliedRgbaTile,
  parameters: GaussianBlurV2Parameters,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  return applyGaussianBlurInDomain(
    tile,
    parameters,
    options,
    GAUSSIAN_BLUR_V2_CONTRACT.inputColorDomain,
  );
}

/** V2 `image.blur` 的像素兼容内核：保留旧 Canvas/CSS Blur 的感知域语义和 120px 封顶。 */
export function applyLegacyGaussianBlurV1(
  tile: Float32PremultipliedRgbaTile,
  radiusPixels: number,
  options: Float32TileProcessOptions = {},
): Float32PremultipliedRgbaTile {
  return applyGaussianBlurInDomain(
    tile,
    { radius: Math.min(120, Math.max(0, radiusPixels)), mip: 0 },
    options,
    LEGACY_GAUSSIAN_BLUR_V1_CONTRACT.inputColorDomain,
  );
}

function applyGaussianBlurInDomain(
  tile: Float32PremultipliedRgbaTile,
  parameters: GaussianBlurV2Parameters,
  options: Float32TileProcessOptions,
  colorDomain: CpuReferenceKernelContract['inputColorDomain'],
): Float32PremultipliedRgbaTile {
  assertFloat32PremultipliedRgbaTile(tile, colorDomain);
  const geometry = resolveGaussianBlurV2Geometry(parameters);
  if (geometry.radiusAtMip === 0) {
    const copy = createFloat32PremultipliedRgbaTile(
      tile.width,
      tile.height,
      tile.colorDomain,
      new Float32Array(tile.data),
      tile.workingSpace,
      tile.transferFunction,
      tile.referenceWhiteNits,
    );
    return mixProcessedWithMask(tile, copy, options.mask);
  }

  let workingWidth = tile.width;
  let workingHeight = tile.height;
  let working: Float32Array<ArrayBufferLike> = new Float32Array(tile.data);
  let actualPyramidLevel = 0;
  while (
    actualPyramidLevel < geometry.pyramidLevel
    && (workingWidth > 1 || workingHeight > 1)
  ) {
    const reduced = downsamplePremultiplied2x(working, workingWidth, workingHeight);
    working = reduced.data;
    workingWidth = reduced.width;
    workingHeight = reduced.height;
    actualPyramidLevel += 1;
  }

  const sigma = geometry.radiusAtMip / (2 ** actualPyramidLevel);
  if (workingWidth > 1 || workingHeight > 1) {
    working = convolveSeparableClamp(working, workingWidth, workingHeight, sigma);
  }
  if (workingWidth !== tile.width || workingHeight !== tile.height) {
    working = resizeBilinearClamp(
      working,
      workingWidth,
      workingHeight,
      tile.width,
      tile.height,
    );
  }
  const processed = createFloat32PremultipliedRgbaTile(
    tile.width,
    tile.height,
    tile.colorDomain,
    working,
    tile.workingSpace,
    tile.transferFunction,
    tile.referenceWhiteNits,
  );
  return mixProcessedWithMask(tile, processed, options.mask);
}

function convolveSeparableClamp(
  source: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  const kernel = createGaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetOffset = (y * width + x) * 4;
      for (let tap = -radius; tap <= radius; tap += 1) {
        const sampleX = clampInteger(x + tap, 0, width - 1);
        const sourceOffset = (y * width + sampleX) * 4;
        const weight = kernel[tap + radius];
        for (let channel = 0; channel < 4; channel += 1) {
          horizontal[targetOffset + channel] += source[sourceOffset + channel] * weight;
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetOffset = (y * width + x) * 4;
      for (let tap = -radius; tap <= radius; tap += 1) {
        const sampleY = clampInteger(y + tap, 0, height - 1);
        const sourceOffset = (sampleY * width + x) * 4;
        const weight = kernel[tap + radius];
        for (let channel = 0; channel < 4; channel += 1) {
          output[targetOffset + channel] += horizontal[sourceOffset + channel] * weight;
        }
      }
    }
  }
  return output;
}

function createGaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= total;
  return kernel;
}

function downsamplePremultiplied2x(
  source: Float32Array,
  width: number,
  height: number,
): { width: number; height: number; data: Float32Array } {
  const outputWidth = Math.max(1, Math.ceil(width / 2));
  const outputHeight = Math.max(1, Math.ceil(height / 2));
  const data = new Float32Array(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const targetOffset = (y * outputWidth + x) * 4;
      let sampleCount = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        const sampleY = y * 2 + dy;
        if (sampleY >= height) continue;
        for (let dx = 0; dx < 2; dx += 1) {
          const sampleX = x * 2 + dx;
          if (sampleX >= width) continue;
          const sourceOffset = (sampleY * width + sampleX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            data[targetOffset + channel] += source[sourceOffset + channel];
          }
          sampleCount += 1;
        }
      }
      for (let channel = 0; channel < 4; channel += 1) {
        data[targetOffset + channel] /= sampleCount;
      }
    }
  }
  return { width: outputWidth, height: outputHeight, data };
}

function resizeBilinearClamp(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const output = new Float32Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = ((y + 0.5) * sourceHeight / targetHeight) - 0.5;
    const y0 = clampInteger(Math.floor(sourceY), 0, sourceHeight - 1);
    const y1 = clampInteger(y0 + 1, 0, sourceHeight - 1);
    const vertical = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = ((x + 0.5) * sourceWidth / targetWidth) - 0.5;
      const x0 = clampInteger(Math.floor(sourceX), 0, sourceWidth - 1);
      const x1 = clampInteger(x0 + 1, 0, sourceWidth - 1);
      const horizontal = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const targetOffset = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = interpolate(
          source[(y0 * sourceWidth + x0) * 4 + channel],
          source[(y0 * sourceWidth + x1) * 4 + channel],
          horizontal,
        );
        const bottom = interpolate(
          source[(y1 * sourceWidth + x0) * 4 + channel],
          source[(y1 * sourceWidth + x1) * 4 + channel],
          horizontal,
        );
        output[targetOffset + channel] = interpolate(top, bottom, vertical);
      }
    }
  }
  return output;
}

function validateGaussianParameters(parameters: GaussianBlurV2Parameters): void {
  if (!Number.isFinite(parameters.radius) || parameters.radius < 0) {
    throw new Error('Gaussian 半径必须是非负有限数');
  }
  if (!Number.isFinite(parameters.mip) || parameters.mip < 0 || parameters.mip > 30) {
    throw new Error('Gaussian mip 必须是 0～30 的有限数');
  }
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
