import { createDefaultDiffusionOperationParams } from './diffusionParams';
import type { DiffusionDensity, DiffusionMode, DiffusionOperationParams } from './types';

export type DiffusionPresetIntensity = 'low' | 'medium' | 'high';

export type DiffusionPresetId =
  | 'black-mist-low'
  | 'black-mist-medium'
  | 'black-mist-high'
  | 'white-mist-low'
  | 'white-mist-medium'
  | 'white-mist-high'
  | 'glow-low'
  | 'glow-medium'
  | 'glow-high';

/** 第三阶段已写入文档的预设 ID，读取时映射到当前中等强度预设。 */
export type LegacyDiffusionPresetId = 'black-mist-soft' | 'white-mist-soft' | 'glow-soft';
export type DiffusionPresetSelectionId = DiffusionPresetId | LegacyDiffusionPresetId;

/**
 * 预设就是「模式 × 档位」的调校基准，因此不再单独存 presetId：
 * mode + density 已经唯一确定一组基准值，再存一个 ID 只会和用户的手动微调打架。
 */
export interface DiffusionPresetPatch {
  readonly strength: number;
  readonly glowRange: number;
  readonly highlightResponse: number;
  readonly softness: number;
  readonly blackRetention: number;
  readonly detailRetention: number;
  readonly colorRetention: number;
  /** 仅辉光基准会给值；黑柔/白柔用不到它们，给了反而会覆盖用户在辉光下的调校。 */
  readonly glowExposure?: number;
  readonly highlightRolloff?: number;
}

export interface DiffusionPresetDefinition {
  readonly id: DiffusionPresetId;
  readonly version: 1;
  readonly mode: DiffusionMode;
  readonly intensity: DiffusionPresetIntensity;
  readonly name: { readonly zh: string; readonly en: string };
  readonly description: { readonly zh: string; readonly en: string };
  readonly parameters: DiffusionPresetPatch;
  readonly source: {
    readonly reference: string;
    readonly url: string;
    readonly usage: string;
    readonly license: string;
  };
  readonly applicability: readonly string[];
  readonly nonGuarantees: readonly string[];
  apply: (base: DiffusionOperationParams) => DiffusionOperationParams;
}

const METHOD_REFERENCE = {
  reference: 'ProMist-5K 公开线性空间多尺度扩散方法论文',
  url: 'https://arxiv.org/html/2601.19295v1',
  usage: '仅参考线性空间、归一化多尺度散射与质量评估方法；不使用论文数据集或图像资产。',
  license: '预设不包含外部照片、裁剪、特征或直接派生资产；不声明品牌或镜头档位复刻。',
} as const;

const COMMON_APPLICABILITY = [
  '八位 sRGB JPEG、PNG、WebP 输入与输出',
  '使用共享 WebGPU 配方，Sharp 仅作为兼容降级',
] as const;

const COMMON_NON_GUARANTEES = [
  '不对应任何品牌滤镜、镜头或具体档位',
  '不承诺 RAW、HDR、十六位、ACES 或 OpenColorIO 输出',
  '不同显示器、曝光和高光范围会影响主观观感',
] as const;

/**
 * 三档强度大致对应摄影里 1/8、1/4、1/2 的观感量级。
 *
 * 有效柔化量 = strength × 档位系数 × 模式 energyScale × highlightGain，也就是「整幅画面
 * 被换成散射版本的比例」。黑柔三档约 0.17 / 0.31 / 0.51，白柔约 0.21 / 0.40 / 0.67。
 * 黑柔的 blackRetention 高、白柔低，是因为黑柔的黑颗粒本来就要把散进暗部的光吸掉，
 * 白柔要留下那层奶雾。
 */
const DIFFUSION_PRESETS: readonly DiffusionPresetDefinition[] = [
  createPreset({
    id: 'black-mist-low', mode: 'black_mist', intensity: 'low',
    name: { zh: '通用黑柔 · 轻', en: 'General Black Mist · Low' },
    description: { zh: '轻微柔化并在亮部周围留下收敛的光晕，黑位几乎不动。', en: 'A restrained overall softening with a compact halo around highlights and untouched blacks.' },
    parameters: { strength: 0.45, glowRange: 0.3, highlightResponse: 0.45, softness: 0.2, blackRetention: 0.9, detailRetention: 0.85, colorRetention: 0.95 },
  }),
  createPreset({
    id: 'black-mist-medium', mode: 'black_mist', intensity: 'medium',
    name: { zh: '通用黑柔 · 中', en: 'General Black Mist · Medium' },
    description: { zh: '明确的柔焦与亮部渗色，反差和黑位仍然守得住。', en: 'Clear soft-focus and highlight bleed while contrast and the black point hold up.' },
    parameters: { strength: 0.58, glowRange: 0.5, highlightResponse: 0.5, softness: 0.3, blackRetention: 0.88, detailRetention: 0.8, colorRetention: 0.92 },
  }),
  createPreset({
    id: 'black-mist-high', mode: 'black_mist', intensity: 'high',
    name: { zh: '通用黑柔 · 强', en: 'General Black Mist · High' },
    description: { zh: '厚重的柔焦与光晕，暗部靠黑颗粒吸收避免整体抬灰。', en: 'Heavy soft-focus and halation, with shadow absorption keeping the frame from washing out.' },
    parameters: { strength: 0.75, glowRange: 0.7, highlightResponse: 0.55, softness: 0.4, blackRetention: 0.85, detailRetention: 0.72, colorRetention: 0.88 },
  }),
  createPreset({
    id: 'white-mist-low', mode: 'white_mist', intensity: 'low',
    name: { zh: '通用白柔 · 轻', en: 'General White Mist · Low' },
    description: { zh: '薄薄一层奶雾，反差略降、黑位微微抬起。', en: 'A thin milky veil that eases contrast and lifts the black point slightly.' },
    parameters: { strength: 0.42, glowRange: 0.4, highlightResponse: 0.5, softness: 0.3, blackRetention: 0.45, detailRetention: 0.8, colorRetention: 0.9 },
  }),
  createPreset({
    id: 'white-mist-medium', mode: 'white_mist', intensity: 'medium',
    name: { zh: '通用白柔 · 中', en: 'General White Mist · Medium' },
    description: { zh: '弥散范围明显更远，反差和锐度都被压下来。', en: 'A markedly wider haze that pulls down both contrast and definition.' },
    parameters: { strength: 0.55, glowRange: 0.55, highlightResponse: 0.55, softness: 0.45, blackRetention: 0.4, detailRetention: 0.72, colorRetention: 0.85 },
  }),
  createPreset({
    id: 'white-mist-high', mode: 'white_mist', intensity: 'high',
    name: { zh: '通用白柔 · 强', en: 'General White Mist · High' },
    description: { zh: '浓重奶雾，黑位明显抬起，画面接近梦幻柔焦。', en: 'A dense milky haze with clearly lifted blacks, approaching a dreamy soft-focus look.' },
    parameters: { strength: 0.72, glowRange: 0.7, highlightResponse: 0.6, softness: 0.6, blackRetention: 0.35, detailRetention: 0.62, colorRetention: 0.78 },
  }),
  createPreset({
    id: 'glow-low', mode: 'glow', intensity: 'low',
    name: { zh: '通用辉光 · 轻', en: 'General Glow · Low' },
    description: { zh: '只扩散最亮区域，以小范围光晕轻微增强光感。', en: 'Blooms only the brightest regions with a restrained, compact halo.' },
    parameters: { strength: 0.5, glowRange: 0.35, highlightResponse: 0.42, softness: 0.3, blackRetention: 1, detailRetention: 1, colorRetention: 0.96, glowExposure: 0.5, highlightRolloff: 0.5 },
  }),
  createPreset({
    id: 'glow-medium', mode: 'glow', intensity: 'medium',
    name: { zh: '通用辉光 · 中', en: 'General Glow · Medium' },
    description: { zh: '平滑扩展亮部光晕，同时保持高光核心和黑位稳定。', en: 'Smoothly expands highlights while preserving the source core and black point.' },
    parameters: { strength: 0.62, glowRange: 0.52, highlightResponse: 0.5, softness: 0.45, blackRetention: 1, detailRetention: 1, colorRetention: 0.93, glowExposure: 0.58, highlightRolloff: 0.62 },
  }),
  createPreset({
    id: 'glow-high', mode: 'glow', intensity: 'high',
    name: { zh: '通用辉光 · 强', en: 'General Glow · High' },
    description: { zh: '宽而连续的光晕，允许光源过曝并让相邻光晕互相融合。', en: 'A broad continuous halo that lets sources blow out and neighbouring halos merge.' },
    parameters: { strength: 0.82, glowRange: 0.72, highlightResponse: 0.58, softness: 0.65, blackRetention: 1, detailRetention: 1, colorRetention: 0.9, glowExposure: 0.72, highlightRolloff: 0.75 },
  }),
];

const LEGACY_PRESET_ALIASES: Readonly<Record<LegacyDiffusionPresetId, DiffusionPresetId>> = {
  'black-mist-soft': 'black-mist-medium',
  'white-mist-soft': 'white-mist-medium',
  'glow-soft': 'glow-medium',
};

export function listDiffusionPresets(): readonly DiffusionPresetDefinition[] {
  return DIFFUSION_PRESETS;
}

export function getDiffusionPreset(presetId: string): DiffusionPresetDefinition | undefined {
  const canonicalId = isLegacyDiffusionPresetId(presetId) ? LEGACY_PRESET_ALIASES[presetId] : presetId;
  return DIFFUSION_PRESETS.find((entry) => entry.id === canonicalId);
}

export function applyDiffusionPreset(presetId: DiffusionPresetSelectionId): DiffusionOperationParams {
  const preset = getDiffusionPreset(presetId);
  if (!preset) throw new Error(`未知柔光预设：${presetId}`);
  return preset.apply(createDefaultDiffusionOperationParams());
}

/**
 * 取「模式 × 档位」对应的调校基准。用户切换模式或档位时套用它，
 * 因为同一组数值在黑柔和辉光下的观感差别很大，直接沿用上一模式的数值会很怪。
 */
export function resolveDiffusionPreset(
  mode: DiffusionMode,
  density: DiffusionDensity
): DiffusionPresetDefinition {
  const preset = DIFFUSION_PRESETS.find(
    (entry) => entry.mode === mode && entry.intensity === density
  );
  if (!preset) throw new Error(`缺少柔光基准：${mode} / ${density}`);
  return preset;
}

/** 切换模式/档位时保留用户已开启的着色设置，只替换光学参数。 */
export function applyDiffusionPresetForSelection(
  base: DiffusionOperationParams,
  mode: DiffusionMode,
  density: DiffusionDensity
): DiffusionOperationParams {
  return resolveDiffusionPreset(mode, density).apply(base);
}

function createPreset(
  preset: Omit<DiffusionPresetDefinition, 'version' | 'source' | 'applicability' | 'nonGuarantees' | 'apply'>
): DiffusionPresetDefinition {
  return {
    ...preset,
    version: 1,
    source: METHOD_REFERENCE,
    applicability: COMMON_APPLICABILITY,
    nonGuarantees: COMMON_NON_GUARANTEES,
    apply: (base) => applyPresetPatch(base, preset),
  };
}

function applyPresetPatch(
  base: DiffusionOperationParams,
  preset: Pick<DiffusionPresetDefinition, 'mode' | 'intensity' | 'parameters'>
): DiffusionOperationParams {
  return {
    ...base,
    mode: preset.mode,
    density: preset.intensity,
    ...preset.parameters,
  };
}

function isLegacyDiffusionPresetId(value: string): value is LegacyDiffusionPresetId {
  return value === 'black-mist-soft' || value === 'white-mist-soft' || value === 'glow-soft';
}
