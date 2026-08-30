import type { VgpuGlowOperationParams } from './vgpuGlowParams';

export const VGPU_GLOW_RECIPE_VERSION = 8 as const;

export interface VgpuGlowScatterLevel {
  /** 相对全分辨率的连续 2× 降采样倍数。 */
  divisor: number;
  /** 当前 13-tap + progressive tent 链在全分辨率像素中的实测等效标准差。 */
  effectiveSigmaPx: number;
  /** 逐通道归一化能量；色差为零时三个通道严格相同。 */
  weight: readonly [number, number, number];
}

export interface VgpuGlowRecipe {
  schemaVersion: typeof VGPU_GLOW_RECIPE_VERSION;
  image: {
    width: number;
    height: number;
    referenceDimension: number;
  };
  /** 以下三个量都位于虚拟场景辐射域，而不是显示域 0～1 亮度。 */
  sourceThresholdRadiance: number;
  sourceKneeRadiance: number;
  sourceRadianceCeiling: number;
  sourceGain: number;
  intensity: number;
  responseExposure: number;
  whiteHeat: number;
  scatterLevels: readonly VgpuGlowScatterLevel[];
  /** 预览缩放时据此重新离散同一个连续 PSF，而不是近似搬运旧 mip 权重。 */
  scatterModel: {
    envelopeFraction: number;
    optical: VgpuGlowOpticalScatterModel;
    chromaticAberration: number;
  };
  tintLinear: readonly [number, number, number];
  tintEnabled: boolean;
  chromaticAberration: number;
  chromaticOffsetPx: number;
  /** 只在辉光层存在时启用的亚量化抖动，用于打散低位深渐变条带。 */
  ditherAmount: number;
}

export interface CompileVgpuGlowRecipeOptions {
  width: number;
  height: number;
}

export interface VgpuGlowOpticalScatterModel {
  coreEnergy: number;
  inverseCubeEnergy: number;
  inverseSquareEnergy: number;
  coreSigmaPx: number;
  coreLogWidth: number;
  reachScale: number;
}

const MIN_SCATTER_LEVEL_COUNT = 4;
const MAX_SCATTER_LEVEL_COUNT = 12;

/**
 * 把界面参数编译成与分辨率无关的光学散射配方。
 *
 * 这里不再把 Spencer PSF 在每个名义 mip 尺度采样一次。那种做法既忽略了 GPU 滤波链
 * 的真实方差，也把极窄的中心峰和长尾硬塞进同一组权重，容易在相邻 octave 之间形成
 * 可见的肩部。新配方按眼内眩光研究中的 core / skirt 分解构造三个连续分量：
 *
 * 1. 对数高斯核心：模拟衍射、失焦和传感器附近的紧致散射；
 * 2. 每 octave 能量约为 1/σ 的近场裙部：对应径向反三次方衰减；
 * 3. 每 octave 近似等能量的远场光幕：对应 Deep Glow 与经典眩光模型的反平方衰减。
 *
 * 三部分都使用实际滤波核的等效 σ，并由同一个光滑包络控制可见范围。总能量逐通道
 * 严格归一，半径只改变能量在尺度间的分布，不会凭空把整张图越调越亮。
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
      intensity: 0.92,
      responseExposure: 0.72,
      sourceGain: 0.46,
      radianceCeiling: 7.2,
      scatter: {
        coreEnergy: 0.34,
        inverseCubeEnergy: 0.48,
        inverseSquareEnergy: 0.18,
        coreSigmaPx: 2.8,
        coreLogWidth: 0.85,
        reachScale: 0.9,
      },
    }
    : params.look === 'neon'
      ? {
        intensity: 1.28,
        responseExposure: 0.88,
        sourceGain: 0.62,
        radianceCeiling: 9.2,
        scatter: {
          coreEnergy: 0.48,
          inverseCubeEnergy: 0.4,
          inverseSquareEnergy: 0.12,
          coreSigmaPx: 2.45,
          coreLogWidth: 0.82,
          reachScale: 0.8,
        },
      }
      : {
        intensity: 1.12,
        responseExposure: 0.8,
        sourceGain: 0.52,
        radianceCeiling: 8.2,
        scatter: {
          coreEnergy: 0.24,
          inverseCubeEnergy: 0.38,
          inverseSquareEnergy: 0.38,
          coreSigmaPx: 4.0,
          coreLogWidth: 0.9,
          reachScale: 1.05,
        },
      };
  const thresholdDisplay = 0.035 + Math.pow(params.sourceThreshold, 1.8) * 0.72;
  const kneeDisplay = 0.025 + (1 - params.sourceThreshold) * 0.1;
  const thresholdRadiance = reconstructVirtualRadiance(
    thresholdDisplay,
    look.radianceCeiling
  );
  const kneeRadiance = Math.max(
    0.025,
    reconstructVirtualRadiance(
      Math.min(0.98, thresholdDisplay + kneeDisplay),
      look.radianceCeiling
    ) - thresholdRadiance
  );
  const scatterEnvelopeFraction = interpolate(
    1 / 320,
    0.46 * look.scatter.reachScale,
    Math.pow(radius, 1.35)
  );

  return {
    schemaVersion: VGPU_GLOW_RECIPE_VERSION,
    image: {
      width: options.width,
      height: options.height,
      referenceDimension,
    },
    sourceThresholdRadiance: thresholdRadiance,
    sourceKneeRadiance: kneeRadiance,
    sourceRadianceCeiling: look.radianceCeiling,
    sourceGain: look.sourceGain,
    // 低段保留精细调节，高段把创作范围扩展到约 2.5×。这不是线性暴力增亮：
    // PSF 总能量仍归一，只让用户能把有限虚拟 HDR 辐射真正推入强发光区。
    intensity: params.intensity * look.intensity
      * (0.72 + 1.78 * params.intensity * params.intensity),
    responseExposure: look.responseExposure,
    whiteHeat: params.whiteHeat,
    scatterLevels: compileOpticalScatterLevels(
      referenceDimension,
      scatterEnvelopeFraction,
      look.scatter,
      params.chromaticAberration
    ),
    scatterModel: {
      envelopeFraction: scatterEnvelopeFraction,
      optical: look.scatter,
      chromaticAberration: params.chromaticAberration,
    },
    tintLinear: parseLinearRgb(params.tintColor),
    tintEnabled: params.tintEnabled,
    chromaticAberration: params.chromaticAberration,
    // 位移只作用于柔化后的散射层，最大值仍足以形成清晰但没有硬边副本的 RGB 分离。
    chromaticOffsetPx: Math.pow(params.chromaticAberration, 1.55) * (0.75 + radius * 5.25),
    ditherAmount: 0.00075,
  };
}

/**
 * 预览会先缩到像素预算内。这里在新分辨率上重新离散同一个连续 core/skirt 模型，
 * 避免把原图的离散 mip 权重近似搬运后在小尺寸预览里放大误差。
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
  const scaledOptical = {
    ...recipe.scatterModel.optical,
    coreSigmaPx: Math.max(0.5, recipe.scatterModel.optical.coreSigmaPx * scale),
  };
  return {
    ...recipe,
    image: { width, height, referenceDimension },
    scatterLevels: compileOpticalScatterLevels(
      referenceDimension,
      recipe.scatterModel.envelopeFraction,
      scaledOptical,
      recipe.scatterModel.chromaticAberration
    ),
    scatterModel: {
      ...recipe.scatterModel,
      optical: scaledOptical,
    },
    chromaticOffsetPx: recipe.chromaticOffsetPx * scale,
  };
}

/**
 * 当前 GPU 链的单轴方差：13-tap 连续降采样、逐层 3×3 tent 重建与最终双线性放大
 * 合并后为 1.5d² - 3.25。这个量来自离散脉冲响应测量；d=2 时 σ≈1.658px，随后
 * 渐近于 1.224745d。所有 PSF 计算必须使用它，不能再把 d 当成 σ。
 */
export function effectiveScatterSigmaPx(divisor: number): number {
  return Math.sqrt(Math.max(0.25, 1.5 * divisor * divisor - 3.25));
}

function compileOpticalScatterLevels(
  referenceDimension: number,
  envelopeFraction: number,
  model: VgpuGlowOpticalScatterModel,
  chromaticAberration: number
): readonly VgpuGlowScatterLevel[] {
  const count = resolveScatterLevelCount(referenceDimension);
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const sigmas = divisors.map(effectiveScatterSigmaPx);
  const envelope = sigmas.map((sigma) =>
    Math.exp(-0.5 * Math.pow(sigma / referenceDimension / envelopeFraction, 2))
  );
  const core = normalizeWeights(sigmas.map((sigma, index) =>
    Math.exp(-0.5 * Math.pow(Math.log(sigma / model.coreSigmaPx) / model.coreLogWidth, 2))
      * envelope[index]
  ));
  const inverseCube = normalizeWeights(sigmas.map((sigma, index) =>
    envelope[index] / sigma
  ));
  const inverseSquare = normalizeWeights(envelope);
  const base = normalizeWeights(sigmas.map((_, index) =>
    core[index] * model.coreEnergy
      + inverseCube[index] * model.inverseCubeEnergy
      + inverseSquare[index] * model.inverseSquareEnergy
  ));
  const spectralTilt = 0.07 * chromaticAberration;
  const channels = [spectralTilt, 0, -spectralTilt].map((tilt) =>
    normalizeWeights(base.map((weight, index) =>
      weight * Math.pow(sigmas[index] / sigmas[0], tilt)
    ))
  );

  return divisors.map((divisor, index) => ({
    divisor,
    effectiveSigmaPx: sigmas[index],
    weight: [channels[0][index], channels[1][index], channels[2][index]] as const,
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

/** 与亮源提取 WGSL 一致的有限逆指数响应，供配方和数值回归共同使用。 */
export function reconstructVirtualRadiance(value: number, ceiling: number): number {
  const maximumDisplayValue = 1 - Math.exp(-ceiling);
  return Math.min(
    ceiling,
    -Math.log(Math.max(1 - clamp(value, 0, maximumDisplayValue), Math.exp(-ceiling)))
  );
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
