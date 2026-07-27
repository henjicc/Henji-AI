import type {
  DiffusionMode,
  DiffusionOperationParams,
  DiffusionQuality,
} from './types';

export const DIFFUSION_RECIPE_VERSION = 2 as const;
export const DIFFUSION_SCALE_COUNT = 6 as const;

export interface DiffusionScaleRecipe {
  index: number;
  radius: number;
  weight: number;
}

export interface DiffusionRecipe {
  version: typeof DIFFUSION_RECIPE_VERSION;
  mode: DiffusionMode;
  quality: DiffusionQuality;
  strength: number;
  densityMultiplier: number;
  image: {
    width: number;
    height: number;
    referenceDimension: number;
    aspectCorrection: readonly [number, number];
  };
  source: {
    /** 高光响应在 EV(log2) 空间求值，故直接透传 EV，不再预先换算成线性值。 */
    thresholdEV: number;
    softKneeEV: number;
    power: number;
    highlightGain: number;
    microGain: number;
    /** 裁切高光外推量（资料 §7）。质量特性而非风格选择，故不作为用户参数。 */
    highlightRecovery: number;
  };
  scales: readonly DiffusionScaleRecipe[];
  energy: {
    scatterFraction: number;
    veil: number;
  };
  tone: {
    blackRetention: number;
    highlightCompression: number;
    scatterDesaturation: number;
  };
  detail: {
    highFrequencyRetention: number;
    midFrequencyRetention: number;
  };
  tint: {
    /** 已归一到亮度 1 的染色系数，乘上去不改变散射光总亮度 */
    rgb: readonly [number, number, number];
    /** 0..1，染色混合量 */
    amount: number;
    /** 散射光增益，1 为不变 */
    gain: number;
  };
}

export interface CompileDiffusionRecipeOptions {
  width: number;
  height: number;
  quality?: DiffusionQuality;
}

const DENSITY_MULTIPLIERS = {
  low: 0.55,
  medium: 0.78,
  high: 1,
} as const;

/**
 * 模式派生量。这些不是用户参数——微扩散、雾幕、高光压缩正是黑柔与白柔的区别所在，
 * 做成滑块既没人看得懂，调错还会让两种模式退化成同一效果的强弱差别。
 */
const MODE_RESPONSE = {
  black_mist: {
    highlightAmount: 0.5,
    microAmount: 0.18,
    longTailBias: 0.82,
    energyScale: 0.72,
    veil: 0.035,
    highlightCompression: 0.08,
    desaturationScale: 0.35,
    power: 1.35,
  },
  white_mist: {
    highlightAmount: 0.44,
    microAmount: 0.72,
    longTailBias: 1,
    energyScale: 0.9,
    veil: 0.11,
    highlightCompression: 0.12,
    desaturationScale: 0.8,
    power: 1.05,
  },
  glow: {
    highlightAmount: 0.72,
    microAmount: 0.05,
    longTailBias: 1.3,
    energyScale: 1,
    veil: 0,
    highlightCompression: 0.16,
    desaturationScale: 0.3,
    power: 1.6,
  },
} as const;

const NEAR_RADIUS_RANGE = [0.0015, 0.012] as const;
const FAR_RADIUS_RANGE = [0.012, 0.2] as const;
const THRESHOLD_EV_RANGE = [4, -1] as const;
const TAIL_SHAPE_RANGE = [4.5, 1.4] as const;
const MAX_TAIL_AMOUNT = 0.35;
/**
 * 裁切高光外推量。JPEG 把过曝区削平后真实峰值不可知，不外推的话灯光光晕会是
 * 「边缘软、中心扁」的廉价观感（资料 §7）。这是画质修正，没有理由让用户去调。
 */
const HIGHLIGHT_RECOVERY = 0.35;

export function compileDiffusionRecipe(
  params: DiffusionOperationParams,
  options: CompileDiffusionRecipeOptions
): DiffusionRecipe {
  assertImageDimension(options.width, 'width');
  assertImageDimension(options.height, 'height');
  const referenceDimension = Math.max(options.width, options.height);
  const quality = options.quality ?? params.quality;
  const densityMultiplier = DENSITY_MULTIPLIERS[params.density];
  const response = MODE_RESPONSE[params.mode];
  const minimumRadius = 1 / referenceDimension;
  const qualityRadiusScale = quality === 'high' ? 1 : 0.82;

  // 半径按指数插值：线性插值会让滑块前半程几乎看不出变化，后半程又突然爆开。
  const nearRadius = Math.max(
    minimumRadius,
    interpolateExponential(NEAR_RADIUS_RANGE, params.glowRange)
  );
  const farRadius = Math.max(
    nearRadius,
    interpolateExponential(FAR_RADIUS_RANGE, params.glowRange) * qualityRadiusScale
  );

  const tailAmount = params.softness * MAX_TAIL_AMOUNT;
  const tailShape = interpolateLinear(TAIL_SHAPE_RANGE, params.softness);
  const weights = compileScaleWeights(tailShape, tailAmount, response.longTailBias);
  const scales = weights.map((weight, index) => ({
    index,
    radius: interpolateRadius(nearRadius, farRadius, index),
    weight,
  }));

  const strength = clamp01(params.strength * densityMultiplier);
  // 散射源 E 里已经带上了 highlightAmount / microAmount，这里再乘一次“源能量”是重复
  // 计价，会让扣除系数比加回系数小一个量级、变成凭空造光。合成阶段扣与加共用本系数，
  // 尺度权重和模糊核又都归一化到 1，全局能量因此自动守恒。
  const scatterFraction = clamp01(strength * response.energyScale);

  return {
    version: DIFFUSION_RECIPE_VERSION,
    mode: params.mode,
    quality,
    strength,
    densityMultiplier,
    image: {
      width: options.width,
      height: options.height,
      referenceDimension,
      aspectCorrection: [
        referenceDimension / options.width,
        referenceDimension / options.height,
      ],
    },
    source: {
      thresholdEV: interpolateLinear(THRESHOLD_EV_RANGE, params.highlightResponse),
      softKneeEV: 0.6 + params.highlightResponse * 0.6,
      power: response.power,
      highlightGain: response.highlightAmount,
      microGain: response.microAmount,
      highlightRecovery: HIGHLIGHT_RECOVERY,
    },
    scales,
    energy: {
      scatterFraction,
      veil: response.veil * strength,
    },
    tone: {
      blackRetention: params.blackRetention,
      highlightCompression: response.highlightCompression,
      scatterDesaturation: (1 - params.colorRetention) * response.desaturationScale,
    },
    detail: {
      highFrequencyRetention: 0.55 + params.detailRetention * 0.45,
      midFrequencyRetention: 0.9 + params.detailRetention * 0.1,
    },
    tint: compileTint(params),
  };
}

/**
 * 着色系数。色相/饱和度归一到亮度 1，因此染色本身不改变散射光总量；
 * 亮度是刻意的艺术控制（资料 §6.3 的“艺术加法模式”），会在 ±50% 内偏离能量守恒。
 */
function compileTint(params: DiffusionOperationParams): DiffusionRecipe['tint'] {
  if (!params.tint.enabled) {
    return { rgb: [1, 1, 1], amount: 0, gain: 1 };
  }
  return {
    rgb: normalizeToUnitLuminance(hslToRgb(params.tint.hue, params.tint.saturation, 0.5)),
    amount: params.tint.saturation,
    gain: 1 + params.tint.lightness * 0.5,
  };
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hPrime = ((hue % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = pickHueSector(hPrime, c, x);
  return [r + m, g + m, b + m];
}

function pickHueSector(hPrime: number, c: number, x: number): [number, number, number] {
  if (hPrime < 1) return [c, x, 0];
  if (hPrime < 2) return [x, c, 0];
  if (hPrime < 3) return [0, c, x];
  if (hPrime < 4) return [0, x, c];
  if (hPrime < 5) return [x, 0, c];
  return [c, 0, x];
}

function normalizeToUnitLuminance(
  rgb: [number, number, number]
): [number, number, number] {
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (luminance <= 1e-6) return [1, 1, 1];
  return [rgb[0] / luminance, rgb[1] / luminance, rgb[2] / luminance];
}

function compileScaleWeights(
  tailShape: number,
  tailAmount: number,
  longTailBias: number
): number[] {
  const raw = Array.from({ length: DIFFUSION_SCALE_COUNT }, (_, index) => {
    const normalizedIndex = index / (DIFFUSION_SCALE_COUNT - 1);
    const nearWeight = Math.exp(-normalizedIndex * tailShape);
    const tailWeight = Math.pow(normalizedIndex, 1.5) * tailAmount * longTailBias;
    return Math.max(Number.EPSILON, nearWeight + tailWeight);
  });
  const sum = raw.reduce((total, weight) => total + weight, 0);
  return raw.map((weight) => weight / sum);
}

function interpolateRadius(nearRadius: number, farRadius: number, index: number): number {
  if (nearRadius === farRadius) return nearRadius;
  const position = index / (DIFFUSION_SCALE_COUNT - 1);
  return nearRadius * Math.pow(farRadius / nearRadius, position);
}

function interpolateLinear(range: readonly [number, number], position: number): number {
  return range[0] + (range[1] - range[0]) * clamp01(position);
}

function interpolateExponential(range: readonly [number, number], position: number): number {
  return range[0] * Math.pow(range[1] / range[0], clamp01(position));
}

function assertImageDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`柔光配方 ${name} 必须是正整数`);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
