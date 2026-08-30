import type {
  VgpuGlowChromaticChannel,
  VgpuGlowOperationParams,
} from './vgpuGlowParams';

export const VGPU_GLOW_RECIPE_VERSION = 14 as const;

/**
 * SDR 发射源估计的公共常量。所有值都与 vgpuGlowBloom.wgsl 保持一致，CPU 参考测试
 * 用它们钉住渐变连续性、中性灰不变量和 8-bit 顶值稳定性。
 */
export const VGPU_GLOW_SOFT_PEAK_TAU = 0.06;
export const VGPU_GLOW_SPECTRAL_CHROMA_START = 0.025;
export const VGPU_GLOW_SPECTRAL_CHROMA_END = 0.1;
export const VGPU_GLOW_LDR_EMISSION_GAMMA = 1.35;
/** 至少保留约 46 个 8-bit code value 的肩部，避免最高门槛把 254→255 放大成亮点。 */
export const VGPU_GLOW_HDR_SHOULDER_MAX_START = 0.82;

export interface VgpuGlowScatterLevel {
  /** 相对全分辨率的连续 2× 降采样倍数。 */
  divisor: number;
  /** 当前 13-tap + 坐标对齐的 progressive tent 链在全分辨率像素中的精确等效标准差。 */
  effectiveSigmaPx: number;
  /** 逐通道归一化能量；色差为零时三个通道严格相同。 */
  weight: readonly [number, number, number];
  /** 白热能量只使用紧致 core PSF；各层之和严格为 1。 */
  whiteCoreWeight: number;
}

export interface VgpuGlowRecipe {
  schemaVersion: typeof VGPU_GLOW_RECIPE_VERSION;
  image: {
    width: number;
    height: number;
    referenceDimension: number;
  };
  /** 亮源资格在显示域判断，避免把肉眼连续的 LDR 渐变在线性域中挖出暗洞。 */
  sourceThresholdDisplay: number;
  sourceKneeDisplay: number;
  /** SDR emissive prior 在裁白处达到的有限虚拟 HDR 增益。 */
  sourceMaximumRadiance: number;
  sourceGain: number;
  intensity: number;
  responseExposure: number;
  whiteHeat: number;
  scatterLevels: readonly VgpuGlowScatterLevel[];
  /** 预览缩放时据此重新离散同一个连续 PSF，而不是近似搬运旧 mip 权重。 */
  scatterModel: {
    envelopeFraction: number;
    optical: VgpuGlowOpticalScatterModel;
  };
  tintLinear: readonly [number, number, number];
  tintEnabled: boolean;
  chromaticAberration: number;
  chromaticOffsetPx: number;
  chromaticChannelIndices: readonly [0 | 1 | 2, 0 | 1 | 2];
  /** Pixel Aberration 之外的轻量 Glow Aberration；每个通道的 PSF 能量仍严格归一。 */
  chromaticRadiusMultipliers: readonly [number, number, number];
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
 * 2. 有限核心的 Moffat 中场：远离核心后每 octave 能量渐近 1/σ，对应径向反三次方；
 * 3. 有限核心的远场光幕：远离核心后每 octave 渐近等能量，对应反平方衰减。
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
  // knee 始终小于 threshold，因此纯黑严格保持零能量；低门槛仍保留柔和过渡。
  const kneeDisplay = thresholdDisplay * interpolate(
    0.68,
    0.32,
    params.sourceThreshold
  );
  const scatterEnvelopeFraction = interpolate(
    1 / 320,
    0.46 * look.scatter.reachScale,
    Math.pow(radius, 1.35)
  );
  const chromaticChannelIndices = params.chromaticChannels.map(
    resolveChromaticChannelIndex
  ) as [0 | 1 | 2, 0 | 1 | 2];
  // Pixel Aberration 的几何间距独立于总辉光半径。满量程约为短边的 0.8%，
  // 既能在普通预览里明确看见，又不会把主体复制成夸张的 Glitch 重影。
  const maximumChromaticOffsetPx = clamp(
    Math.min(options.width, options.height) * 0.008,
    6,
    18
  );
  // Pixel Aberration 是通道的整体空间位移，不是“原位一份 + 位移一份”
  // 的交叉混合。因此滑杆只线性控制像素间距；从 0 开始自然连续，同时避免
  // 中段把细线复制成双峰、把圆环复制成双圈。
  const chromaticOffsetPx = params.chromaticAberration * maximumChromaticOffsetPx;
  const chromaticRadiusMultipliers = resolveChromaticRadiusMultipliers(
    chromaticChannelIndices,
    params.chromaticAberration
  );
  const scatterLevels = compileChromaticScatterLevels(
    referenceDimension,
    scatterEnvelopeFraction,
    look.scatter,
    chromaticRadiusMultipliers
  );

  return {
    schemaVersion: VGPU_GLOW_RECIPE_VERSION,
    image: {
      width: options.width,
      height: options.height,
      referenceDimension,
    },
    sourceThresholdDisplay: thresholdDisplay,
    sourceKneeDisplay: kneeDisplay,
    sourceMaximumRadiance: look.radianceCeiling,
    sourceGain: look.sourceGain,
    // 低段保留精细调节，高段把创作范围扩展到约 2.5×。这不是线性暴力增亮：
    // PSF 总能量仍归一，只让用户能把有限虚拟 HDR 辐射真正推入强发光区。
    intensity: params.intensity * look.intensity
      * (0.72 + 1.78 * params.intensity * params.intensity),
    responseExposure: look.responseExposure,
    whiteHeat: params.whiteHeat,
    scatterLevels,
    scatterModel: {
      envelopeFraction: scatterEnvelopeFraction,
      optical: look.scatter,
    },
    tintLinear: parseLinearRgb(params.tintColor),
    tintEnabled: params.tintEnabled,
    chromaticAberration: params.chromaticAberration,
    // 完整辉光通道在相机响应前向相反方向整体位移；卷积与平移可交换，因此这与
    // “先移动发光输入、再进入 PSF”严格等价，同时保持未发光原图完全不动。
    chromaticOffsetPx,
    chromaticChannelIndices,
    chromaticRadiusMultipliers,
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
  const chromaticOffsetPx = recipe.chromaticOffsetPx * scale;
  return {
    ...recipe,
    image: { width, height, referenceDimension },
    scatterLevels: compileChromaticScatterLevels(
      referenceDimension,
      recipe.scatterModel.envelopeFraction,
      scaledOptical,
      recipe.chromaticRadiusMultipliers
    ),
    scatterModel: {
      ...recipe.scatterModel,
      optical: scaledOptical,
    },
    chromaticOffsetPx,
  };
}

/**
 * 当前 GPU 链的单轴方差：固定 half-phase 的 13-tap 降采样、坐标对齐的 3×3 tent
 * 重建与最终双线性放大合并后为 1.5d² - 3.5。这个量来自精确离散脉冲响应；d=2 时
 * σ≈1.581px，随后
 * 渐近于 1.224745d。所有 PSF 计算必须使用它，不能再把 d 当成 σ。
 */
export function effectiveScatterSigmaPx(divisor: number): number {
  return Math.sqrt(Math.max(0.25, 1.5 * divisor * divisor - 3.5));
}

function compileOpticalScatterLevels(
  referenceDimension: number,
  envelopeFraction: number,
  model: VgpuGlowOpticalScatterModel
): readonly VgpuGlowScatterLevel[] {
  const count = resolveScatterLevelCount(referenceDimension);
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const sigmas = divisors.map(effectiveScatterSigmaPx);
  const envelope = sigmas.map((sigma) =>
    Math.exp(-0.5 * Math.pow(sigma / referenceDimension / envelopeFraction, 2))
  );

  // 每个 GPU level 都是单位能量的有效 Gaussian basis。对数等距的 σ 上，
  // coefficient 就是该尺度对应的对数环带能量。因此这里采样连续 PSF 目标，
  // 而不是把名义 mip divisor 直接当作模糊半径。
  const core = normalizeWeights(sigmas.map((sigma, index) =>
    Math.exp(-0.5 * Math.pow(Math.log(sigma / model.coreSigmaPx) / model.coreLogWidth, 2))
      * envelope[index]
  ));

  // (r² + a²)^(-q/2) 的单位积分 Gaussian 尺度混合，其每个 log-σ 的能量为
  //   w(σ) ∝ σ^(2-q) exp(-a² / 2σ²)。
  // q=3 于远场严格回到 1/σ，q=2 严格回到 octave 等权；指数项只负责把
  // 两个幂律从有限大小的核心平滑地启动，不会造出另一圈描边。
  const inverseCube = normalizeWeights(sigmas.map((sigma, index) =>
    finitePowerLawScaleEnergy(sigma, model.coreSigmaPx * 0.5, 3) * envelope[index]
  ));
  const inverseSquare = normalizeWeights(sigmas.map((sigma, index) =>
    finitePowerLawScaleEnergy(sigma, model.coreSigmaPx * 1.5, 2) * envelope[index]
  ));
  const base = normalizeWeights(sigmas.map((_, index) =>
    core[index] * model.coreEnergy
      + inverseCube[index] * model.inverseCubeEnergy
      + inverseSquare[index] * model.inverseSquareEnergy
  ));

  return divisors.map((divisor, index) => ({
    divisor,
    effectiveSigmaPx: sigmas[index],
    // 默认三通道使用相同的正值 PSF；Pixel / Glow Aberration 会在下一步分别
    // 改变空间位置与少量尺度分布，不需要边缘检测、差分核或描边。
    weight: [base[index], base[index], base[index]] as const,
    whiteCoreWeight: core[index],
  }));
}

function compileChromaticScatterLevels(
  referenceDimension: number,
  envelopeFraction: number,
  model: VgpuGlowOpticalScatterModel,
  multipliers: readonly [number, number, number]
): readonly VgpuGlowScatterLevel[] {
  const base = compileOpticalScatterLevels(
    referenceDimension,
    envelopeFraction,
    model
  );
  const channels = multipliers.map((multiplier) => compileOpticalScatterLevels(
    referenceDimension,
    envelopeFraction * multiplier,
    {
      ...model,
      coreSigmaPx: model.coreSigmaPx * multiplier,
    }
  ));
  return base.map((level, index) => ({
    ...level,
    weight: [
      channels[0][index].weight[0],
      channels[1][index].weight[0],
      channels[2][index].weight[0],
    ] as const,
  }));
}

function resolveChromaticRadiusMultipliers(
  channels: readonly [0 | 1 | 2, 0 | 1 | 2],
  amount: number
): readonly [number, number, number] {
  const spread = smootherstep(0, 1, amount) * 0.18;
  const multipliers: [number, number, number] = [1, 1, 1];
  multipliers[channels[0]] = 1 - spread;
  multipliers[channels[1]] = 1 + spread;
  return multipliers;
}

function resolveChromaticChannelIndex(channel: VgpuGlowChromaticChannel): 0 | 1 | 2 {
  if (channel === 'red') return 0;
  if (channel === 'green') return 1;
  return 2;
}

function finitePowerLawScaleEnergy(
  sigma: number,
  softeningRadius: number,
  radialExponent: 2 | 3
): number {
  const coreRatio = softeningRadius / sigma;
  return Math.pow(sigma, 2 - radialExponent)
    * Math.exp(-0.5 * coreRatio * coreRatio);
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

/** 与 WGSL softChannelPeak 完全一致的可微通道峰值。 */
export function resolveSoftChannelPeak(
  displayRgb: readonly [number, number, number]
): number {
  const channels = displayRgb.map((value) => clamp(value, 0, 1));
  const highest = Math.max(...channels);
  const weights = channels.map((value) =>
    Math.exp((value - highest) / VGPU_GLOW_SOFT_PEAK_TAU)
  );
  const weightSum = weights.reduce((total, value) => total + value, 0);
  return channels.reduce(
    (total, value, index) => total + value * weights[index],
    0
  ) / Math.max(weightSum, 0.000001);
}

/**
 * SDR 没有真实 emissive buffer，因此用色度受控的光谱覆盖度作为艺术先验：
 * 中性灰严格保持原值；明确的彩色多通道过渡可获得连续能量，不在 RGB 主导通道
 * 交换处形成暗沟。该函数只决定发射幅度，线性 RGB 色度仍由原像素单独提供。
 */
export function resolveEmissionPeak(
  displayRgb: readonly [number, number, number]
): number {
  const channels = displayRgb.map((value) => clamp(value, 0, 1));
  const channelPeak = resolveSoftChannelPeak(
    channels as [number, number, number]
  );
  const mean = channels.reduce((total, value) => total + value, 0) / 3;
  const chroma = Math.sqrt(channels.reduce(
    (total, value) => total + (value - mean) * (value - mean),
    0
  ) / 3);
  const spectralPeak = Math.min(Math.cbrt(channels.reduce(
    (total, value) => total + value * value * value,
    0
  )), 1);
  const chromaConfidence = smootherstep(
    VGPU_GLOW_SPECTRAL_CHROMA_START,
    VGPU_GLOW_SPECTRAL_CHROMA_END,
    chroma
  );
  return interpolate(channelPeak, spectralPeak, chromaConfidence);
}

/**
 * 与 WGSL 的有限虚拟 HDR 扩展一致。输入是已经解析的显示域发射幅度；低于 shoulder
 * 只做部分 SDR 反响应，接近裁白时平滑到 maximumRadiance，顶端一阶斜率有限。
 */
export function reconstructVirtualRadiance(
  displayValue: number,
  thresholdDisplay: number,
  kneeDisplay: number,
  maximumRadiance: number
): number {
  const value = clamp(displayValue, 0, 1);
  const shoulderStart = Math.min(
    clamp(thresholdDisplay + kneeDisplay, 0, 0.9999),
    VGPU_GLOW_HDR_SHOULDER_MAX_START
  );
  const headroom = smootherstep(
    shoulderStart,
    1,
    value
  );
  const expansion = interpolate(1, Math.max(maximumRadiance, 1), headroom);
  return Math.pow(value, VGPU_GLOW_LDR_EMISSION_GAMMA) * expansion;
}

/** 与 WGSL 亮源资格和虚拟 HDR 扩展完全一致的标量 CPU 参考。 */
export function extractVirtualEmitterRadiance(
  displayValue: number,
  thresholdDisplay: number,
  kneeDisplay: number,
  maximumRadiance: number
): number {
  const value = clamp(displayValue, 0, 1);
  if (value <= 0) return 0;
  const knee = Math.max(kneeDisplay, 0.0001);
  const confidence = smootherstep(
    thresholdDisplay - knee,
    thresholdDisplay + knee,
    value
  );
  return reconstructVirtualRadiance(
    value,
    thresholdDisplay,
    kneeDisplay,
    maximumRadiance
  ) * confidence;
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

function smootherstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * amount * (
    amount * (amount * 6 - 15) + 10
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
