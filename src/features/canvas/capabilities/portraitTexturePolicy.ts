import type { ModelDefinition } from '@/core/types'

import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from './modelCompatibility'
import type { CanvasImageCapabilityModelPolicy } from './types'

export const PORTRAIT_TEXTURE_CONTRACT_VERSION = 1 as const
export const PORTRAIT_TEXTURE_TEMPLATE_VERSION = 'portrait-texture-gpt-image-2-v1'
export const PORTRAIT_TEXTURE_DEFAULT_MODEL_ID = 'fal-ai-gpt-image-2'

export const PORTRAIT_TEXTURE_PRESETS = [
  'natural-detail',
  'commercial-clean',
  'film-soft',
  'cinematic-depth',
] as const

export const PORTRAIT_TEXTURE_STRENGTHS = ['subtle', 'balanced'] as const

export type PortraitTexturePreset = (typeof PORTRAIT_TEXTURE_PRESETS)[number]
export type PortraitTextureStrength = (typeof PORTRAIT_TEXTURE_STRENGTHS)[number]

export interface PortraitTextureSettingsV1 {
  portraitTextureContractVersion: 1
  preset: PortraitTexturePreset
  strength: PortraitTextureStrength
  userPrompt: string
}

export interface PortraitTextureRoutePreparation {
  compatible: boolean
  reasons: string[]
  model: ModelDefinition | null
  params: DynamicValueMap
  prompt: string
  templateVersion: typeof PORTRAIT_TEXTURE_TEMPLATE_VERSION
}

export interface PortraitTextureGenerationInput {
  route: PortraitTextureRoutePreparation & { model: ModelDefinition }
  settings: PortraitTextureSettingsV1
  params: DynamicValueMap
  upstream: { images: string[]; videos: []; audios: [] }
}

export const DEFAULT_PORTRAIT_TEXTURE_SETTINGS: PortraitTextureSettingsV1 = {
  portraitTextureContractVersion: PORTRAIT_TEXTURE_CONTRACT_VERSION,
  preset: 'natural-detail',
  strength: 'subtle',
  userPrompt: '',
}

/**
 * GPT Image 2 官方支持图片编辑并自动以高保真处理输入图，但官方同时注明
 * 人物与品牌元素的一致性仍可能失败；因此这里仅声明“保守编辑”而非身份保证。
 */
export const PORTRAIT_TEXTURE_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['gpt-image-2'],
  requiredTags: ['image-to-image', 'supports-image-editing'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'fal' },
    { providerId: 'apimart', allowedChannels: ['official'] },
    { providerId: 'kie' },
    { providerId: 'grsai', allowedChannels: ['vip'] },
  ],
  semanticRequirements: {
    referenceImages: { min: 1, max: 1 },
    outputCount: 1,
    quality: 'medium',
  },
} as const satisfies CanvasImageCapabilityModelPolicy

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function boundedPrompt(value: unknown): string {
  // 留出足够空间给固定保留约束，避免供应商 20K 提示词上限截断安全边界。
  return typeof value === 'string' ? value.trim().slice(0, 8_000) : ''
}

export function normalizePortraitTextureSettings(value: unknown): PortraitTextureSettingsV1 {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS }
  const raw = value as Record<string, unknown>
  if (
    raw.portraitTextureContractVersion !== undefined
    && raw.portraitTextureContractVersion !== PORTRAIT_TEXTURE_CONTRACT_VERSION
  ) {
    throw new Error(`不支持的人像质感契约版本：${String(raw.portraitTextureContractVersion)}`)
  }
  return {
    portraitTextureContractVersion: PORTRAIT_TEXTURE_CONTRACT_VERSION,
    preset: enumValue(raw.preset, PORTRAIT_TEXTURE_PRESETS, 'natural-detail'),
    strength: enumValue(raw.strength, PORTRAIT_TEXTURE_STRENGTHS, 'subtle'),
    userPrompt: boundedPrompt(raw.userPrompt),
  }
}

const PRESET_PROMPTS: Record<PortraitTexturePreset, string> = {
  'natural-detail': 'natural photographic finish, retain believable pores and fine skin texture, restrained local contrast, no plastic smoothing',
  'commercial-clean': 'clean commercial portrait finish, controlled highlights, tidy tonal separation, realistic skin texture, no excessive retouching',
  'film-soft': 'subtle filmic softness, gentle highlight roll-off, fine restrained grain, natural skin texture and color',
  'cinematic-depth': 'cinematic tonal depth, shaped but believable contrast, controlled highlights and shadows, realistic skin detail',
}

const STRENGTH_PROMPTS: Record<PortraitTextureStrength, string> = {
  subtle: 'Apply only a very subtle change. Prefer the source image whenever an edit is not necessary.',
  balanced: 'Apply a restrained, clearly visible finish without changing facial structure or scene content.',
}

/** 版本化隐藏提示词。所有预设和强度只表达模型近似，不对应物理或检测参数。 */
export function compilePortraitTexturePrompt(settingsValue: unknown): string {
  const settings = normalizePortraitTextureSettings(settingsValue)
  const user = settings.userPrompt
    ? `\n\n[用户补充]\n${settings.userPrompt}`
    : ''
  return `[输入角色]\n输入图片是唯一内容与身份参考。若画面中没有人物，不要声称检测到人脸；仅对可见主体做同等级的保守影调与质感处理。\n\n[编辑任务]\n${PRESET_PROMPTS[settings.preset]}\n${STRENGTH_PROMPTS[settings.strength]}${user}\n\n[固定保留约束]\n保持每个人的身份外观、五官几何、表情、发型、肤色、年龄呈现、体型、姿势与人数；保持原始构图、镜头、服装、饰品、背景、物体、文字与标志。不要换脸，不要改变种族或年龄，不要美白或改变体型，不要新增或删除人物与物体。\n\n[输出]\n输出一张可继续编辑的普通图片；不添加边框、拼图、水印或说明文字。`
}

function sanitizeCapabilityParams(params: DynamicValueMap): DynamicValueMap {
  const next = { ...params }
  delete next.output_format
  delete next.outputFormat
  // GPT Image 2 对所有输入自动启用高保真，官方要求不要发送 input_fidelity。
  delete next.input_fidelity
  delete next.inputFidelity
  delete next.falGptImage2MaskUrl
  delete next.apimartGptImage2MaskUrl
  return next
}

export function preparePortraitTextureRoute(
  settingsValue: unknown,
  imageModels: readonly ModelDefinition[],
  selectedModelId = PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  currentParams: DynamicValueMap = {},
): PortraitTextureRoutePreparation {
  let settings: PortraitTextureSettingsV1
  try {
    settings = normalizePortraitTextureSettings(settingsValue)
  } catch (error) {
    return {
      compatible: false,
      reasons: [error instanceof Error ? error.message : '人像质感设置无效'],
      model: null,
      params: {},
      prompt: '',
      templateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
    }
  }

  const candidates = resolveCanvasCapabilityModelCandidates(
    imageModels,
    PORTRAIT_TEXTURE_MODEL_POLICY,
  ).candidates
  const selected = candidates.find(({ model }) => model.meta.id === selectedModelId)
  if (!selected) {
    return {
      compatible: false,
      reasons: [selectedModelId === PORTRAIT_TEXTURE_DEFAULT_MODEL_ID
        ? '首版默认模型 Fal GPT Image 2 当前不可用'
        : '所选模型不属于已核验的人像质感编辑路线'],
      model: null,
      params: {},
      prompt: compilePortraitTexturePrompt(settings),
      templateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
    }
  }

  const mapped = mapCanvasCapabilityModelParams(
    selected.model,
    PORTRAIT_TEXTURE_MODEL_POLICY,
    currentParams,
  )
  return {
    compatible: mapped.compatible,
    reasons: mapped.reasons.map((reason) => reason.message),
    model: selected.model,
    params: sanitizeCapabilityParams(mapped.params),
    prompt: compilePortraitTexturePrompt(settings),
    templateVersion: PORTRAIT_TEXTURE_TEMPLATE_VERSION,
  }
}

export function preparePortraitTextureGenerationInput(
  settingsValue: unknown,
  imageModels: readonly ModelDefinition[],
  sourceImages: readonly string[],
  selectedModelId = PORTRAIT_TEXTURE_DEFAULT_MODEL_ID,
  currentParams: DynamicValueMap = {},
): PortraitTextureGenerationInput {
  const sources = sourceImages.filter((item) => typeof item === 'string' && item.trim().length > 0)
  if (sources.length !== 1) throw new Error('人像质感调节必须且只能提供 1 张源图')
  const settings = normalizePortraitTextureSettings(settingsValue)
  const route = preparePortraitTextureRoute(
    settings,
    imageModels,
    selectedModelId,
    currentParams,
  )
  if (!route.compatible || !route.model) {
    throw new Error(route.reasons.join('；') || '当前没有可用的人像质感编辑模型')
  }
  const params = {
    ...route.params,
    prompt: route.prompt,
    text: route.prompt,
    images: [sources[0]],
    uploadedFilePaths: [sources[0]],
  }
  return {
    route: { ...route, model: route.model },
    settings,
    params,
    upstream: { images: [sources[0]], videos: [], audios: [] },
  }
}

export function summarizePortraitTextureSettings(settingsValue: unknown): string {
  const settings = normalizePortraitTextureSettings(settingsValue)
  return `${settings.preset} · ${settings.strength}`
}
