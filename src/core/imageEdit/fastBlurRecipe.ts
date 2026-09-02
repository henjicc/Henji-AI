export const FAST_BLUR_RECIPE_VERSION = 3 as const;
export const FAST_BLUR_MAX_PYRAMID_LEVELS = 10;
export const FAST_BLUR_MAX_PAIRED_TAPS = 8;

export interface FastBlurPairedTap {
  readonly offset: number;
  readonly weight: number;
}

export interface FastBlurRecipe {
  readonly schemaVersion: typeof FAST_BLUR_RECIPE_VERSION;
  readonly radiusPx: number;
  readonly pyramidLevel: number;
  readonly sigmaAtPyramidLevel: number;
  readonly centerWeight: number;
  readonly pairedTaps: readonly FastBlurPairedTap[];
}

const MAX_SIGMA_AT_PYRAMID_LEVEL = 5;

/**
 * 把任意文档半径编译为固定上限的 GPU 配方。
 * 大半径先进入连续 2× 金字塔，使最终一维卷积始终不超过 8 个双线性合并 tap。
 */
export function compileFastBlurRecipe(
  radiusPx: number,
  width: number,
  height: number,
): FastBlurRecipe {
  validateFiniteNonNegative(radiusPx, '模糊半径');
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('模糊配方尺寸必须是正整数');
  }
  const requestedLevel = radiusPx <= MAX_SIGMA_AT_PYRAMID_LEVEL
    ? 0
    : Math.ceil(Math.log2(radiusPx / MAX_SIGMA_AT_PYRAMID_LEVEL));
  const maxDimensionLevel = Math.max(0, Math.ceil(Math.log2(Math.max(width, height))));
  const pyramidLevel = Math.min(
    FAST_BLUR_MAX_PYRAMID_LEVELS,
    maxDimensionLevel,
    requestedLevel,
  );
  const sigmaAtPyramidLevel = radiusPx / (2 ** pyramidLevel);
  const weights = gaussianWeights(sigmaAtPyramidLevel);
  const pairedTaps: FastBlurPairedTap[] = [];
  for (let offset = 1; offset < weights.length; offset += 2) {
    const first = weights[offset];
    const second = weights[offset + 1] ?? 0;
    const combined = first + second;
    if (combined <= 0) continue;
    pairedTaps.push({
      offset: (offset * first + (offset + 1) * second) / combined,
      weight: combined,
    });
  }
  if (pairedTaps.length > FAST_BLUR_MAX_PAIRED_TAPS) {
    throw new Error(`模糊 GPU 配方超过 ${FAST_BLUR_MAX_PAIRED_TAPS} 个合并 tap`);
  }
  return {
    schemaVersion: FAST_BLUR_RECIPE_VERSION,
    radiusPx,
    pyramidLevel,
    sigmaAtPyramidLevel,
    centerWeight: weights[0],
    pairedTaps,
  };
}

function gaussianWeights(sigma: number): Float64Array {
  if (sigma <= 0) return new Float64Array([1]);
  const radius = Math.min(FAST_BLUR_MAX_PAIRED_TAPS * 2, Math.max(1, Math.ceil(3 * sigma)));
  const weights = new Float64Array(radius + 1);
  let total = 1;
  weights[0] = 1;
  for (let offset = 1; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset] = weight;
    total += weight * 2;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
  return weights;
}

function validateFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须是大于等于 0 的有限数`);
}
