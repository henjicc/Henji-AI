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

export interface DiffusionGlowLevel {
  /** 相对全分辨率的降采样倍数，同时也是这一级的有效 σ（像素） */
  divisor: number;
  /** 逐通道权重。三通道略微错开就是色散，尾部因此显出色偏而不是等比放大的同一个颜色。 */
  weight: readonly [number, number, number];
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
  /** 仅辉光模式使用。摄影柔光走能量守恒，这一组量刻意不守恒。 */
  glow: {
    /**
     * 逐倍频程的金字塔层。层数按图片尺寸铺到 mip 只剩几个像素为止，不是固定六级：
     * 层数不够时最外层之后就没有更宽的尺度可叠，PSF 会从幂律突然退化成高斯并直接
     * 归零，观感上就是「光晕有个看得见的外边界」。实测固定六级时衰减指数在
     * 128px→256px 处从 3.3 跳到 8.7，512px 之后已经是 138。
     */
    levels: readonly DiffusionGlowLevel[];
    /** 线性叠加增益，允许 > 1：把光源推到过曝正是辉光的观感来源 */
    exposure: number;
    /** 保色相肩部起点；1 表示不滚降 */
    shoulderKnee: number;
    /** 越过肩部后颜色向白靠拢的比例 */
    bleach: number;
    /** 全分辨率紧致核在辉光里的占比，与金字塔互补加权 */
    coreWeight: number;
    /** 辉光最亮处向白靠拢的程度（Deep Glow 式强度渐变着色） */
    tintCoreWhite: number;
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
    energyScale: 0.86,
    veil: 0.075,
    highlightCompression: 0.1,
    desaturationScale: 0.8,
    power: 1.05,
  },
  glow: {
    // 辉光使用独立的数字 Bloom：亮通提取只保留阈值以上的增量，
    // 因此这里不再沿用摄影扩散为防止造光而刻意压低的源增益。
    highlightAmount: 1,
    microAmount: 0,
    longTailBias: 1,
    energyScale: 1,
    veil: 0,
    highlightCompression: 0,
    desaturationScale: 0.3,
    power: 1,
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

/**
 * 辉光曝光量程。摄影柔光的 scatterFraction 必须落在 [0,1] 才不会凭空造光，辉光没有
 * 这个约束——光源被推到过曝、相邻光晕互相融合本身就是要的效果，靠合成末端的保色相
 * 肩部收溢出而不是靠把增益锁在 1 以内。指数插值，否则滑块前半程几乎看不出变化。
 */
const GLOW_EXPOSURE_RANGE = [0.6, 6] as const;
/** 肩部起点。滚降拉满时从 0.45 开始压，高光有足够长度渐近到白而不是硬切。 */
const GLOW_SHOULDER_RANGE = [1, 0.45] as const;
/**
 * 全分辨率紧致核占比。金字塔最紧一级在 1/2 分辨率，光源近处 1~2px 的过渡在那里是
 * 缺失的，光晕和光源核心之间会有一道断层。范围越小越依赖这个补偿。
 */
const GLOW_CORE_WEIGHT_RANGE = [0.3, 0.05] as const;

/**
 * PSF 的径向衰减指数（A ∝ r^-n）。
 *
 * 每一级 mip 的降采样核与 tent 上采样核都归一到 1，所以每级都是面积归一的模糊：
 * 点光源经过第 i 级后总能量不变、峰值 ∝ 1/σ_i²。整条 PSF 就是
 *   A(r) = Σ w_i · exp(-r²/2σ_i²) / (2πσ_i²)
 * 在半径 r 附近由 σ_i≈r 那一级主导，于是 A(r) ≈ w(σ=r)/r²。
 * 想要 A ∝ r^-n，就要 w_i ∝ σ_i^(2-n)——各级等权得到 1/r²，每级减半得到 1/r³。
 *
 * 真实镜头与人眼的眩光大致落在 2~3 之间，所以量程取这一带。此前用的是
 * exp(-i·decay) 的经验衰减，近场指数其实落在 2.4~2.9 是对的，问题全在层数不够。
 */
const GLOW_FALLOFF_EXPONENT_RANGE = [3.3, 2.05] as const;
/**
 * 参与加权的尺度区间，按**占长边的比例**定义，不是按工作分辨率的像素数。
 *
 * mip 的 divisor 是工作分辨率像素，而实时预览会先降到 200 万像素预算
 * （webgpuRuntime.ts 的 IMAGE_EDIT_PREVIEW_MAX_PIXELS），所以同一个 divisor 在预览里
 * 占画面的比例是导出时的两倍多。照 divisor 直接配权重的话，预览和导出的光晕相对尺寸
 * 和亮度都对不上——实测预览会比导出亮 1.4~2.6 倍，等于对着一个会骗人的预览调参。
 *
 * anchor 在归一化比例上，两个分辨率就会挑到同一组归一化尺度。
 */
const GLOW_MIN_SIGMA_FRACTION = 1 / 1024;
/** 最宽一级取长边的一半：光晕的「深」全在这条长尾上，截得早就退回普通高斯辉光。 */
const GLOW_MAX_SIGMA_FRACTION = 1 / 2;
const GLOW_MIN_LEVEL_COUNT = 4;
const GLOW_MAX_LEVEL_COUNT = 12;
/**
 * 尾部色散量。真实玻璃与人眼的散射是有波长依赖的，光晕尾部会偏色而不是等比放大的
 * 同一个颜色——这是「贵的辉光插件」最好认的特征之一。做法是给三通道略微不同的衰减
 * 指数（红更远、蓝更近），再各自归一，因此不产生整体色偏，只产生径向的色相梯度。
 *
 * 属于画质修正而不是风格选择，和裁切高光外推一样不做成滑块。
 */
const GLOW_DISPERSION = 0.3;

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
  const glowLevels = compileGlowLevels(params, referenceDimension);
  // 辉光的真实金字塔在 glow.levels 里（层数随图片尺寸变），scales 只保留前六级的
  // 等价描述，供共享合成布局、缓存签名和 Sharp 降级的半径估算使用。
  const scales = params.mode === 'glow'
    ? glowLevelsToScales(glowLevels, referenceDimension)
    : compileScaleWeights(tailShape, tailAmount, response.longTailBias).map((weight, index) => ({
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
      // 数字 Bloom 保留原始高光核心，只扩散阈值以上的亮度，不猜测已裁切峰值。
      highlightRecovery: params.mode === 'glow' ? 0 : HIGHLIGHT_RECOVERY,
    },
    scales,
    energy: {
      scatterFraction,
      veil: response.veil * strength,
    },
    tone: {
      blackRetention: params.blackRetention,
      // 高光肩部属于效果的一部分；强度为 0 时必须严格保持原图。
      highlightCompression: response.highlightCompression * strength,
      scatterDesaturation: (1 - params.colorRetention) * response.desaturationScale,
    },
    detail: {
      // 细节补偿同样随效果强度归零，避免 0 强度仍出现额外锐化与增亮。
      // 辉光是独立加法层，不应再次锐化底图；细节保留仅属于摄影柔光。
      highFrequencyRetention: params.mode === 'glow'
        ? 0
        : (0.55 + params.detailRetention * 0.45) * strength,
      midFrequencyRetention: params.mode === 'glow'
        ? 0
        : (0.9 + params.detailRetention * 0.1) * strength,
    },
    tint: compileTint(params),
    glow: compileGlow(params, scatterFraction, glowLevels),
  };
}

function compileGlow(
  params: DiffusionOperationParams,
  scatterFraction: number,
  levels: readonly DiffusionGlowLevel[]
): DiffusionRecipe['glow'] {
  const rolloff = clamp01(params.highlightRolloff);
  return {
    levels,
    exposure: scatterFraction * interpolateExponential(GLOW_EXPOSURE_RANGE, params.glowExposure),
    shoulderKnee: interpolateLinear(GLOW_SHOULDER_RANGE, rolloff),
    // 只压不漂白会得到「有色但不亮」的塑料感：真实过曝是往白里跑，不是停在饱和色上。
    bleach: rolloff * 0.8,
    coreWeight: interpolateLinear(GLOW_CORE_WEIGHT_RANGE, params.glowRange),
    // 真实感控制，不跟着色开关走：彩色光源的核心本来就该是过曝的白。
    tintCoreWhite: clamp01(params.glowCoreWhite),
  };
}

/**
 * 铺满归一化尺度区间内的全部倍频程，权重走幂律，逐通道错开指数得到尾部色散。
 *
 * divisor 始终从 2 开始逐级翻倍：金字塔每步只能降一半，一步降 4 倍以上会让固定小核
 * 严重欠采样、亮边冒出复本。归一化尺度低于 GLOW_MIN_SIGMA_FRACTION 的那几级仍然要
 * 生成（后面的层要从它们继续降），但权重记 0——这样归一化的分母只包含真正参与的
 * 尺度，预览和导出就会落在同一组归一化尺度上。
 */
function compileGlowLevels(
  params: DiffusionOperationParams,
  referenceDimension: number
): readonly DiffusionGlowLevel[] {
  const count = resolveGlowLevelCount(referenceDimension);
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const minDivisor = referenceDimension * GLOW_MIN_SIGMA_FRACTION;
  const skipped = divisors.filter((divisor) => divisor < minDivisor).length;
  const contributing = Math.max(1, count - skipped);
  const exponent = interpolateLinear(GLOW_FALLOFF_EXPONENT_RANGE, params.glowRange);
  // 红端衰减慢、蓝端衰减快，尾部因此偏暖、近场偏冷。
  const channels = [-1, 0, 1].map((offset) =>
    normalizeWeights(divisors.map((divisor, index) => {
      if (divisor < minDivisor) return 0;
      // 柔和度在幂律之上再抬一点远端，保留「光斑柔和度」原来的语义。
      const tailPosition = (index - skipped) / Math.max(1, contributing - 1);
      const tailLift = 1 + clamp01(params.softness) * tailPosition * 1.2;
      return Math.pow(divisor, 2 - (exponent + offset * GLOW_DISPERSION * 0.25)) * tailLift;
    }))
  );
  return divisors.map((divisor, index) => ({
    divisor,
    weight: [channels[0][index], channels[1][index], channels[2][index]] as const,
  }));
}

/**
 * 取真正参与加权的前六级折算成共享的 scales 形状；radius 是归一化的有效 σ，
 * weight 取绿通道。零权重的那几级只是金字塔链路的中间产物，不能算进来——
 * Sharp 降级按 Σ(radius×weight) 估算模糊半径，混入零权重会把半径整体拉偏。
 */
function glowLevelsToScales(
  levels: readonly DiffusionGlowLevel[],
  referenceDimension: number
): DiffusionScaleRecipe[] {
  const visible = levels
    .filter((level) => level.weight[1] > 0)
    .slice(0, DIFFUSION_SCALE_COUNT);
  const total = visible.reduce((sum, level) => sum + level.weight[1], 0);
  return visible.map((level, index) => ({
    index,
    radius: level.divisor / referenceDimension,
    weight: total > 0 ? level.weight[1] / total : 1 / visible.length,
  }));
}

function resolveGlowLevelCount(referenceDimension: number): number {
  const octaves = Math.floor(Math.log2(referenceDimension * GLOW_MAX_SIGMA_FRACTION));
  return Math.max(GLOW_MIN_LEVEL_COUNT, Math.min(GLOW_MAX_LEVEL_COUNT, octaves));
}

function normalizeWeights(raw: readonly number[]): number[] {
  const sum = raw.reduce((total, weight) => total + weight, 0);
  if (sum <= 0) return raw.map(() => 1 / Math.max(1, raw.length));
  return raw.map((weight) => weight / sum);
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
