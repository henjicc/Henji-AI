import { createDefaultDiffusionOperationParams } from './diffusionParams';
import type { DiffusionMode, DiffusionOperationParams } from './types';

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

export interface DiffusionPresetPatch {
  readonly strength: number;
  readonly density: DiffusionOperationParams['density'];
  readonly source?: Partial<DiffusionOperationParams['source']>;
  readonly scatter?: Partial<DiffusionOperationParams['scatter']>;
  readonly tone?: Partial<DiffusionOperationParams['tone']>;
  readonly detail?: Partial<DiffusionOperationParams['detail']>;
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

const DIFFUSION_PRESETS: readonly DiffusionPresetDefinition[] = [
  createPreset({
    id: 'black-mist-low', mode: 'black_mist', intensity: 'low',
    name: { zh: '通用黑柔 · 轻', en: 'General Black Mist · Low' },
    description: { zh: '轻微压低高光边缘，同时尽量保留黑位和细节。', en: 'A restrained highlight bloom with preserved blacks and detail.' },
    parameters: { strength: 0.18, density: '1/8', scatter: { highlightAmount: 0.06, microAmount: 0.009, farRadius: 0.026, tailAmount: 0.035 }, tone: { veil: 0.004, blackRetention: 0.95, scatterDesaturation: 0.02 }, detail: { highFrequencyRetention: 0.97 } },
  }),
  createPreset({
    id: 'black-mist-medium', mode: 'black_mist', intensity: 'medium',
    name: { zh: '通用黑柔 · 中', en: 'General Black Mist · Medium' },
    description: { zh: '平衡高光散射、黑位保留与长尾雾幕。', en: 'Balanced highlight scatter, black retention, and long-tail haze.' },
    parameters: { strength: 0.35, density: '1/4', scatter: { highlightAmount: 0.12, microAmount: 0.018, farRadius: 0.045, tailAmount: 0.06 }, tone: { veil: 0.012, blackRetention: 0.92, scatterDesaturation: 0.04 }, detail: { highFrequencyRetention: 0.94 } },
  }),
  createPreset({
    id: 'black-mist-high', mode: 'black_mist', intensity: 'high',
    name: { zh: '通用黑柔 · 强', en: 'General Black Mist · High' },
    description: { zh: '更明显的长尾散射，仍避免把暗部完全抬灰。', en: 'Pronounced long-tail scatter while avoiding a fully washed-out black point.' },
    parameters: { strength: 0.56, density: '1/2', scatter: { highlightAmount: 0.2, microAmount: 0.03, nearRadius: 0.004, farRadius: 0.07, tailAmount: 0.11, tailShape: 2.1 }, tone: { veil: 0.022, blackRetention: 0.85, scatterDesaturation: 0.07 }, detail: { highFrequencyRetention: 0.9 } },
  }),
  createPreset({
    id: 'white-mist-low', mode: 'white_mist', intensity: 'low',
    name: { zh: '通用白柔 · 轻', en: 'General White Mist · Low' },
    description: { zh: '轻微微扩散与雾幕，适合保守地柔化亮部。', en: 'Subtle micro-diffusion and veil for conservative highlight softening.' },
    parameters: { strength: 0.16, density: '1/8', scatter: { highlightAmount: 0.07, microAmount: 0.014, farRadius: 0.025, tailAmount: 0.025 }, tone: { veil: 0.012, blackRetention: 0.98, scatterDesaturation: 0.04 }, detail: { highFrequencyRetention: 0.98 } },
  }),
  createPreset({
    id: 'white-mist-medium', mode: 'white_mist', intensity: 'medium',
    name: { zh: '通用白柔 · 中', en: 'General White Mist · Medium' },
    description: { zh: '比黑柔更重视微扩散、雾幕和散射去饱和。', en: 'Prioritises micro-diffusion, veil, and scattered-light desaturation over black mist.' },
    parameters: { strength: 0.28, density: '1/4', scatter: { highlightAmount: 0.1, microAmount: 0.024, farRadius: 0.04, tailAmount: 0.04 }, tone: { veil: 0.024, blackRetention: 0.96, scatterDesaturation: 0.07 }, detail: { highFrequencyRetention: 0.96 } },
  }),
  createPreset({
    id: 'white-mist-high', mode: 'white_mist', intensity: 'high',
    name: { zh: '通用白柔 · 强', en: 'General White Mist · High' },
    description: { zh: '更明显地拓展高光雾幕并降低散射饱和度。', en: 'Expands the highlight veil while visibly desaturating scattered light.' },
    parameters: { strength: 0.48, density: '1/2', scatter: { highlightAmount: 0.17, microAmount: 0.042, farRadius: 0.065, tailAmount: 0.09 }, tone: { veil: 0.05, blackRetention: 0.92, scatterDesaturation: 0.12 }, detail: { highFrequencyRetention: 0.92 } },
  }),
  createPreset({
    id: 'glow-low', mode: 'glow', intensity: 'low',
    name: { zh: '通用辉光 · 轻', en: 'General Glow · Low' },
    description: { zh: '为高亮区域增加小范围光晕，不引入全局雾幕。', en: 'Adds a small highlight halo without introducing a global veil.' },
    parameters: { strength: 0.24, density: '1/4', scatter: { highlightAmount: 0.1, microAmount: 0.014, farRadius: 0.035, tailAmount: 0.05 }, tone: { veil: 0, highlightCompression: 0.08, scatterDesaturation: 0.04 } },
  }),
  createPreset({
    id: 'glow-medium', mode: 'glow', intensity: 'medium',
    name: { zh: '通用辉光 · 中', en: 'General Glow · Medium' },
    description: { zh: '以高亮和长尾散射为主，保持全局黑位稳定。', en: 'Favours highlight and long-tail scatter while keeping the global black point stable.' },
    parameters: { strength: 0.42, density: '1/2', scatter: { highlightAmount: 0.18, microAmount: 0.025, farRadius: 0.06, tailAmount: 0.1 }, tone: { veil: 0, highlightCompression: 0.12, scatterDesaturation: 0.07 } },
  }),
  createPreset({
    id: 'glow-high', mode: 'glow', intensity: 'high',
    name: { zh: '通用辉光 · 强', en: 'General Glow · High' },
    description: { zh: '扩展高光长尾与光晕范围，适合有明确高光主体的画面。', en: 'Extends the highlight tail and halo for images with clear bright subjects.' },
    parameters: { strength: 0.62, density: '1', scatter: { highlightAmount: 0.28, microAmount: 0.04, nearRadius: 0.004, farRadius: 0.095, tailAmount: 0.17, tailShape: 1.8 }, tone: { veil: 0, highlightCompression: 0.2, scatterDesaturation: 0.12 }, detail: { highFrequencyRetention: 0.9 } },
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
  preset: Pick<DiffusionPresetDefinition, 'id' | 'mode' | 'parameters'>
): DiffusionOperationParams {
  const { parameters } = preset;
  return {
    ...base,
    mode: preset.mode,
    presetId: preset.id,
    strength: parameters.strength,
    density: parameters.density,
    source: { ...base.source, ...parameters.source },
    scatter: { ...base.scatter, ...parameters.scatter },
    tone: { ...base.tone, ...parameters.tone },
    detail: { ...base.detail, ...parameters.detail },
  };
}

function isLegacyDiffusionPresetId(value: string): value is LegacyDiffusionPresetId {
  return value === 'black-mist-soft' || value === 'white-mist-soft' || value === 'glow-soft';
}
