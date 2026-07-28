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

export interface DiffusionScatterLevel {
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
    /** 高光处散射掉的光量占比（雾镜颗粒的最大散射率）。 */
    highlightGain: number;
    /**
     * 中暗部同样参与散射的比例下限。
     *
     * 真实雾镜的颗粒对**所有**入射光都散射，只是亮处绝对光量大所以看着像「高光在发光」。
     * 只散阈值以上的部分得到的是 bloom 插件而不是柔光滤镜：既没有 loss of definition，
     * 也不会出现亮部渗进相邻暗部的 halation——这正是旧实现观感不像的根因。
     * 黑柔的地板低于白柔，反差因此保留得更多。
     */
    scatterFloor: number;
    /** 裁切高光外推量（资料 §7）。质量特性而非风格选择，故不作为用户参数。 */
    highlightRecovery: number;
  };
  /**
   * 逐倍频程的散射金字塔，三种模式共用。
   *
   * 黑柔/白柔/辉光的差别在能量去向（守恒扣加 vs 纯加法）与雾幕、黑位保持，不在
   * 散射核的构造方式上，所以散射统一走 mip 链：采样间距恒为输入纹理的 1 texel，
   * 半径由层级累积而来。
   *
   * 此前柔光另走一条「把归一化半径直接乘到稀疏五点核上」的可分离模糊，五个样本
   * 会跨几十个 texel，得到的是五份错位副本而不是模糊——横竖各来一遍就是画面上的
   * 方格重影。实测导出分辨率下第 0 级采样点间隔达 49.5 texel。
   */
  scatterLevels: readonly DiffusionScatterLevel[];
  /** 仅供 Sharp 降级估算模糊半径与缓存签名使用，不参与 WebGPU 散射构建。 */
  scales: readonly DiffusionScaleRecipe[];
  energy: {
    scatterFraction: number;
    veil: number;
  };
  tone: {
    /**
     * 黑颗粒对「散进暗部的杂散光」的吸收量，0 表示不吸收。
     *
     * 资料原话：黑柔的黑色颗粒是用来「补回因为雾颗粒把光散进暗部而损失的那部分反差」。
     * 所以它作用在**加回的散射项**上，而不是像旧实现那样把整个效果 mix 回原图——
     * 后者连柔焦和细节补偿一起撤销，等于暗部完全没有滤镜。
     */
    shadowAbsorption: number;
    highlightCompression: number;
    scatterDesaturation: number;
    /**
     * 散射光自身的色偏，已归一到亮度 1，因此不改变散射总量、只改变 halation 的颜色。
     *
     * 黑柔的 halation 偏暖是这类滤镜公认的特征（资料：老雾镜的光晕比 Pro-Mist 更蓝／
     * 黑柔会把画面稍微推暖）；白柔保持中性。直接光不参与，画面不会整体偏色。
     */
    scatterTint: readonly [number, number, number];
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
 * 模式派生量。这些不是用户参数——散射地板、雾幕、黑颗粒吸收正是黑柔与白柔的区别所在，
 * 做成滑块既没人看得懂，调错还会让两种模式退化成同一效果的强弱差别。
 *
 * 三条外部资料决定了这张表的结构：
 * 1. 所有雾镜都是「悬浮颗粒散射入射光」，产生 halation、反差下降、锐度下降三件事，
 *    因此散射源必须是整幅画面而不是阈值以上的高光（`scatterFloor`）。
 * 2. Pro-Mist 系的光晕比老式雾镜「更集中在光源附近」，黑柔尤甚——所以黑柔的 PSF
 *    更陡、铺得更近（`falloffExponentRange` / `maxSigmaFraction`）。黑位守得住是这条
 *    的结果，不需要额外把暗部整块 mix 回原图。
 * 3. 黑柔的黑色颗粒用来「补回光散进暗部损失的反差」，并且会把画面稍微推暖
 *    （`shadowAbsorb` / `scatterTint`）；白柔不做这件事，于是留下那层奶白雾幕。
 */
const MODE_RESPONSE = {
  black_mist: {
    highlightAmount: 0.85,
    scatterFloor: 0.3,
    energyScale: 0.8,
    // 黑柔靠紧致 PSF + 黑颗粒吸收守黑位，不再额外抬一层全局雾幕。
    veil: 0,
    highlightCompression: 0.06,
    desaturationScale: 0.3,
    power: 1.2,
    falloffExponentRange: [3.4, 2.8],
    maxSigmaFraction: 1 / 16,
    shadowAbsorb: 0.8,
    scatterTint: [1.05, 1, 0.92],
  },
  white_mist: {
    highlightAmount: 0.98,
    // 中暗部也大量散射，这才是白柔那层「奶雾」和明显的 loss of definition 的来源。
    scatterFloor: 0.72,
    energyScale: 0.95,
    veil: 0.09,
    highlightCompression: 0.1,
    desaturationScale: 0.75,
    power: 1,
    falloffExponentRange: [2.95, 2.25],
    maxSigmaFraction: 1 / 3,
    shadowAbsorb: 0.5,
    scatterTint: [1, 1, 1],
  },
  glow: {
    // 辉光使用独立的数字 Bloom：亮通提取只保留阈值以上的增量，
    // 因此这里不再沿用摄影扩散为防止造光而刻意压低的源增益。
    highlightAmount: 1,
    scatterFloor: 0,
    energyScale: 1,
    veil: 0,
    highlightCompression: 0,
    desaturationScale: 0.3,
    power: 1,
    falloffExponentRange: [3.3, 2.05],
    // 光晕的「深」全在这条长尾上，截得早就退回普通高斯辉光。
    maxSigmaFraction: 1 / 2,
    shadowAbsorb: 0,
    scatterTint: [1, 1, 1],
  },
} as const;

const THRESHOLD_EV_RANGE = [4, -1] as const;
/**
 * 裁切高光外推量。JPEG 把过曝区削平后真实峰值不可知，不外推的话灯光光晕会是
 * 「边缘软、中心扁」的廉价观感（资料 §7）。这是画质修正，没有理由让用户去调。
 */
const HIGHLIGHT_RECOVERY = 0.35;

/**
 * 辉光曝光量程。摄影柔光的 scatterFraction 必须落在 [0,1] 才不会凭空造光，辉光没有
 * 这个约束——光源被推到过曝、相邻光晕互相融合本身就是要的效果，靠合成末端的保色相
 * 肩部收溢出而不是靠把增益锁在 1 以内。
 *
 * 线性插值，量程整体上抬。此前用的是 [0.6,6] 指数插值：滑块中点只拿到量程的 32%，
 * 再乘上同样偏小的 scatterFraction，「中间参数」实测只有 0.7 的曝光——用户必须把两个
 * 滑块都拉到八成才能看到本该是中档的效果。指数曲线在这里是反的：辉光的观感亮度大致
 * 正比于曝光，压低前半程只会让整条滑块都不够用。
 */
const GLOW_EXPOSURE_RANGE = [0.5, 9] as const;
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
 * 真实镜头与人眼的眩光大致落在 2~3 之间，所以量程取这一带。逐模式的取值见
 * MODE_RESPONSE.falloffExponentRange：黑柔更陡（守黑位）、白柔更缓（要雾幕）。
 */
/**
 * 参与加权的尺度区间下限，按**占长边的比例**定义，不是按工作分辨率的像素数。
 *
 * mip 的 divisor 是工作分辨率像素，而实时预览会先降到 200 万像素预算
 * （webgpuRuntime.ts 的 IMAGE_EDIT_PREVIEW_MAX_PIXELS），所以同一个 divisor 在预览里
 * 占画面的比例是导出时的两倍多。照 divisor 直接配权重的话，预览和导出的散射相对尺寸
 * 和亮度都对不上——实测预览会比导出亮 1.4~2.6 倍，等于对着一个会骗人的预览调参。
 *
 * anchor 在归一化比例上，两个分辨率就会挑到同一组归一化尺度。上限逐模式给。
 */
const SCATTER_MIN_SIGMA_FRACTION = 1 / 1024;
const SCATTER_MIN_LEVEL_COUNT = 4;
const SCATTER_MAX_LEVEL_COUNT = 12;
/**
 * 尾部色散量。真实玻璃与人眼的散射是有波长依赖的，光晕尾部会偏色而不是等比放大的
 * 同一个颜色——这是「贵的辉光插件」最好认的特征之一。做法是给三通道略微不同的衰减
 * 指数（红更远、蓝更近），再各自归一，因此不产生整体色偏，只产生径向的色相梯度。
 *
 * 属于画质修正而不是风格选择，和裁切高光外推一样不做成滑块。
 */
const SCATTER_DISPERSION = 0.3;

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
  // 三种模式共用同一条散射构建路径。此前柔光另走可分离大半径模糊，五点核的采样点
  // 会跨几十个 texel，产出的是错位副本而不是模糊。
  const scatterLevels = compileScatterLevels(params, referenceDimension);
  // scales 只是 scatterLevels 前六级的等价描述，供缓存签名和 Sharp 降级估算半径用。
  const scales = scatterLevelsToScales(scatterLevels, referenceDimension);

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
      scatterFloor: response.scatterFloor,
      // 数字 Bloom 保留原始高光核心，只扩散阈值以上的亮度，不猜测已裁切峰值。
      highlightRecovery: params.mode === 'glow' ? 0 : HIGHLIGHT_RECOVERY,
    },
    scatterLevels,
    scales,
    energy: {
      scatterFraction,
      veil: response.veil * strength,
    },
    tone: {
      shadowAbsorption: params.blackRetention * response.shadowAbsorb,
      // 高光肩部属于效果的一部分；强度为 0 时必须严格保持原图。
      highlightCompression: response.highlightCompression * strength,
      scatterDesaturation: (1 - params.colorRetention) * response.desaturationScale,
      scatterTint: normalizeToUnitLuminance([
        response.scatterTint[0],
        response.scatterTint[1],
        response.scatterTint[2],
      ]),
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
    glow: compileGlow(params, scatterFraction),
  };
}

function compileGlow(
  params: DiffusionOperationParams,
  scatterFraction: number
): DiffusionRecipe['glow'] {
  const rolloff = clamp01(params.highlightRolloff);
  return {
    exposure: scatterFraction * interpolateLinear(GLOW_EXPOSURE_RANGE, params.glowExposure),
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
function compileScatterLevels(
  params: DiffusionOperationParams,
  referenceDimension: number
): readonly DiffusionScatterLevel[] {
  const response = MODE_RESPONSE[params.mode];
  const count = resolveScatterLevelCount(referenceDimension, response.maxSigmaFraction);
  const divisors = Array.from({ length: count }, (_, index) => 2 ** (index + 1));
  const minDivisor = referenceDimension * SCATTER_MIN_SIGMA_FRACTION;
  const skipped = divisors.filter((divisor) => divisor < minDivisor).length;
  const contributing = Math.max(1, count - skipped);
  const exponent = interpolateLinear(response.falloffExponentRange, params.glowRange);
  // 红端衰减慢、蓝端衰减快，尾部因此偏暖、近场偏冷。
  const channels = [-1, 0, 1].map((offset) =>
    normalizeWeights(divisors.map((divisor, index) => {
      if (divisor < minDivisor) return 0;
      // 柔和度在幂律之上再抬一点远端，保留「光斑柔和度」原来的语义。
      const tailPosition = (index - skipped) / Math.max(1, contributing - 1);
      const tailLift = 1 + clamp01(params.softness) * tailPosition * 1.2;
      return Math.pow(divisor, 2 - (exponent + offset * SCATTER_DISPERSION * 0.25)) * tailLift;
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
function scatterLevelsToScales(
  levels: readonly DiffusionScatterLevel[],
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

function resolveScatterLevelCount(
  referenceDimension: number,
  maxSigmaFraction: number
): number {
  const octaves = Math.floor(Math.log2(referenceDimension * maxSigmaFraction));
  return Math.max(SCATTER_MIN_LEVEL_COUNT, Math.min(SCATTER_MAX_LEVEL_COUNT, octaves));
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

function interpolateLinear(range: readonly [number, number], position: number): number {
  return range[0] + (range[1] - range[0]) * clamp01(position);
}

function assertImageDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`柔光配方 ${name} 必须是正整数`);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
