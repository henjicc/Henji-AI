import type { VgpuGlowOperationParams } from './vgpuGlowParams';

export const VGPU_GLOW_RECIPE_VERSION = 6 as const;

export interface VgpuGlowScatterLevel {
  /** 相对全分辨率的连续 2× 降采样倍数。 */
  divisor: number;
  /** 逐通道归一化能量；通道间的轻微尺度错位模拟波长相关散射。 */
  weight: readonly [number, number, number];
}

export interface VgpuGlowRecipe {
  schemaVersion: typeof VGPU_GLOW_RECIPE_VERSION;
  image: {
    width: number;
    height: number;
    referenceDimension: number;
  };
  threshold: number;
  knee: number;
  hdrBoost: number;
  intensity: number;
  whiteHeat: number;
  /** Spencer 人眼眩光模型映射到图片空间时使用的视场角。越小，光晕越宽。 */
  fieldOfViewDegrees: number;
  scatterLevels: readonly VgpuGlowScatterLevel[];
  bloomExposure: number;
  bloomGamma: number;
  tintLinear: readonly [number, number, number];
  tintEnabled: boolean;
  /** 只补足 1～2px 近场散射，不再把未模糊亮源当描边叠回去。 */
  coreGain: number;
  coreRadiusPx: number;
  chromaticAberration: number;
  chromaticOffsetPx: number;
  /** 只在辉光层存在时启用的亚量化抖动，用于打散低位深渐变条带。 */
  ditherAmount: number;
}

export interface CompileVgpuGlowRecipeOptions {
  width: number;
  height: number;
}

const MIN_SCATTER_LEVEL_COUNT = 4;
const MAX_SCATTER_LEVEL_COUNT = 12;
// 各通道只在 octave 之间搬运少量能量：红端略向长尾，蓝端略向近场；每通道仍归一。
const CHANNEL_SCALE_TILT = [0.08, 0, -0.08] as const;

/**
 * 把界面参数编译成与分辨率无关的物理眩光配方。
 *
 * 散射曲线来自 Spencer 等人的 photopic glare PSF：一个极紧的高斯核心，加上
 * inverse-cube 中场和 inverse-square 长尾。离散到 mip 金字塔时乘以尺度面积 σ²，
 * 得到每个面积归一模糊层应承担的能量；这比手工摆五个高斯权重更接近真实光学，也不会
 * 在最大半径处暴露层级边界。半径仍保留创作语义：Blender Fog Glow 的视场角映射控制
 * 物理曲线宽度，Oniric 式平滑包络控制长尾可见范围。
 */
export function compileVgpuGlowRecipe(
  params: VgpuGlowOperationParams,
  options: CompileVgpuGlowRecipeOptions
): VgpuGlowRecipe {
  assertImageDimension(options.width, 'width');
  assertImageDimension(options.height, 'height');
  const referenceDimension = Math.max(options.width, options.height);
  const radius = params.radius;
  const look = params.look === 'natural'
    ? {
      boost: 2.8,
      intensity: 0.94,
      bloomExposure: 0.9,
      bloomGamma: 1.06,
      core: 0.22,
      fieldOfViewScale: 1.12,
    }
    : params.look === 'neon'
      ? {
        boost: 7.2,
        intensity: 1.38,
        bloomExposure: 1.28,
        bloomGamma: 1.02,
        core: 0.32,
        fieldOfViewScale: 0.92,
      }
      : {
        boost: 4.9,
        intensity: 1.16,
        bloomExposure: 1.08,
        bloomGamma: 1.12,
        core: 0.18,
        fieldOfViewScale: 0.82,
      };
  const fieldOfViewDegrees = clamp(
    interpolate(180, 10, Math.cbrt(radius)) * look.fieldOfViewScale,
    8,
    180
  );
  const scatterEnvelopeFraction = interpolate(
    1 / 256,
    0.48,
    Math.pow(radius, 1.35)
  );

  return {
    schemaVersion: VGPU_GLOW_RECIPE_VERSION,
    image: {
      width: options.width,
      height: options.height,
      referenceDimension,
    },
    threshold: 0.035 + Math.pow(params.sourceThreshold, 1.8) * 0.72,
    knee: 0.08 + (1 - params.sourceThreshold) * 0.24,
    hdrBoost: look.boost,
    intensity: params.intensity * look.intensity,
    whiteHeat: params.whiteHeat,
    fieldOfViewDegrees,
    scatterLevels: compilePhotopicScatterLevels(
      referenceDimension,
      fieldOfViewDegrees,
      scatterEnvelopeFraction
    ),
    bloomExposure: look.bloomExposure,
    bloomGamma: look.bloomGamma,
    tintLinear: parseLinearRgb(params.tintColor),
    tintEnabled: params.tintEnabled,
    coreGain: look.core * (0.72 + params.whiteHeat * 0.38),
    coreRadiusPx: 1.15 + (1 - radius) * 0.85,
    chromaticAberration: params.chromaticAberration,
    // RGB 分离只作用在已经柔化的散射层。偏移可以明显，但不会再复制原图硬边。
    chromaticOffsetPx: Math.pow(params.chromaticAberration, 1.65) * (1 + radius * 7),
    ditherAmount: 0.00075,
  };
}

/**
 * 预览会先缩到像素预算内。这里把完整图片上的尺度能量投影到预览的连续 2× mip 网格，
 * 保持光晕占画面比例、色散偏移和近场核心一致，而不是让同一个 divisor 在预览中变宽。
 */
export function rebaseVgpuGlowRecipeForScale(
  recipe: VgpuGlowRecipe,
  width: number,
  height: number
): VgpuGlowRecipe {
  assertImageDimension(width, 'width');
  assertImageDimension(height, 'height');
  const referenceDimension = Math.max(width, height);
  const scale = referenceDimension / recipe.image.referenceDimension;
  return {
    ...recipe,
    image: { width, height, referenceDimension },
    scatterLevels: projectScatterLevels(recipe.scatterLevels, scale),
    coreRadiusPx: Math.max(0.65, recipe.coreRadiusPx * scale),
    chromaticOffsetPx: recipe.chromaticOffsetPx * scale,
  };
}

function compilePhotopicScatterLevels(
  referenceDimension: number,
  fieldOfViewDegrees: number,
  envelopeFraction: number
): readonly VgpuGlowScatterLevel[] {
  const count = resolveScatterLevelCount(referenceDimension);
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const channels = CHANNEL_SCALE_TILT.map((scaleTilt) =>
    normalizeWeights(divisors.map((divisor) => {
      const sigmaFraction = divisor / referenceDimension;
      const thetaDegrees = sigmaFraction * fieldOfViewDegrees;
      const envelope = Math.exp(-0.5 * Math.pow(sigmaFraction / envelopeFraction, 2));
      // 每层模糊都面积归一，所以乘 σ² 把径向 PSF 振幅换算为该 octave 的总能量。
      return spencerPhotopicPsf(thetaDegrees)
        * sigmaFraction * sigmaFraction
        * envelope
        * Math.pow(divisor, scaleTilt);
    }))
  );
  return divisors.map((divisor, index) => ({
    divisor,
    weight: [channels[0][index], channels[1][index], channels[2][index]] as const,
  }));
}

function spencerPhotopicPsf(thetaDegrees: number): number {
  const theta = Math.max(thetaDegrees, 0);
  const tightCore = 2.61e6 * Math.exp(-Math.pow(theta / 0.02, 2));
  const mediumScatter = 20.91 / Math.pow(theta + 0.02, 3);
  const longScatter = 72.37 / Math.pow(theta + 0.02, 2);
  return tightCore * 0.384 + mediumScatter * 0.478 + longScatter * 0.138;
}

function projectScatterLevels(
  levels: readonly VgpuGlowScatterLevel[],
  scale: number
): readonly VgpuGlowScatterLevel[] {
  const maximumTarget = Math.max(2, ...levels.map((level) => level.divisor * scale));
  const count = clamp(
    Math.ceil(Math.log2(maximumTarget)),
    MIN_SCATTER_LEVEL_COUNT,
    MAX_SCATTER_LEVEL_COUNT
  );
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const channelWeights = divisors.map(() => [0, 0, 0]);

  for (const level of levels) {
    const target = Math.max(2, level.divisor * scale);
    const position = clamp(Math.log2(target) - 1, 0, count - 1);
    const lower = Math.floor(position);
    const upper = Math.min(count - 1, lower + 1);
    const upperAmount = position - lower;
    for (const channel of [0, 1, 2] as const) {
      channelWeights[lower][channel] += level.weight[channel] * (1 - upperAmount);
      channelWeights[upper][channel] += level.weight[channel] * upperAmount;
    }
  }

  for (const channel of [0, 1, 2] as const) {
    const normalized = normalizeWeights(channelWeights.map((weight) => weight[channel]));
    for (let index = 0; index < channelWeights.length; index += 1) {
      channelWeights[index][channel] = normalized[index];
    }
  }

  return divisors.map((divisor, index) => ({
    divisor,
    weight: [
      channelWeights[index][0],
      channelWeights[index][1],
      channelWeights[index][2],
    ] as const,
  }));
}

function resolveScatterLevelCount(referenceDimension: number): number {
  return clamp(
    Math.ceil(Math.log2(referenceDimension * 0.5)),
    MIN_SCATTER_LEVEL_COUNT,
    MAX_SCATTER_LEVEL_COUNT
  );
}

function normalizeWeights(raw: readonly number[]): number[] {
  const sum = raw.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return raw.map(() => 1 / Math.max(1, raw.length));
  return raw.map((value) => value / sum);
}

function parseLinearRgb(color: string): readonly [number, number, number] {
  return [
    srgbToLinear(Number.parseInt(color.slice(1, 3), 16) / 255),
    srgbToLinear(Number.parseInt(color.slice(3, 5), 16) / 255),
    srgbToLinear(Number.parseInt(color.slice(5, 7), 16) / 255),
  ];
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function assertImageDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`辉光 Pro ${label} 必须是正数`);
  }
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
