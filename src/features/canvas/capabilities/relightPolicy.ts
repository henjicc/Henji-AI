import type { ModelDefinition } from '@/core/types'

import {
  mapCanvasCapabilityModelParams,
  resolveCanvasCapabilityModelCandidates,
} from './modelCompatibility'
import type { CanvasImageCapabilityModelPolicy } from './types'

export const RELIGHT_CONTRACT_VERSION = 1 as const
export const RELIGHT_MANUAL_TEMPLATE_VERSION = 'relight-manual-iclight-v1'
export const RELIGHT_SMART_TEMPLATE_VERSION = 'relight-smart-gpt-image-2-v1'

export const RELIGHT_KEY_DIRECTIONS = ['none', 'left', 'right', 'top', 'bottom'] as const
export const RELIGHT_BRIGHTNESS_LEVELS = [-2, -1, 0, 1, 2] as const
export const RELIGHT_COLOR_PRESETS = [
  'neutral', 'warm', 'cool', 'amber', 'red', 'blue', 'cyan', 'magenta',
] as const
export const RELIGHT_RIM_DIRECTIONS = [
  'off', 'left', 'right', 'top', 'top-left', 'top-right', 'bottom',
  'bottom-left', 'bottom-right',
] as const
export const RELIGHT_SMART_PRESETS = [
  'natural-studio', 'soft-window', 'golden-hour', 'overcast',
  'hard-studio', 'moonlight', 'neon', 'dramatic',
] as const

export type RelightMode = 'manual' | 'smart'
export type RelightKeyDirection = (typeof RELIGHT_KEY_DIRECTIONS)[number]
export type RelightBrightness = (typeof RELIGHT_BRIGHTNESS_LEVELS)[number]
export type RelightColorPreset = (typeof RELIGHT_COLOR_PRESETS)[number]
export type RelightRimDirection = (typeof RELIGHT_RIM_DIRECTIONS)[number]
export type RelightSmartPreset = (typeof RELIGHT_SMART_PRESETS)[number]

export interface RelightSettingsV1 {
  relightContractVersion: 1
  lightingMode: RelightMode
  manual: {
    keyDirection: RelightKeyDirection
    brightness: RelightBrightness
    colorPreset: RelightColorPreset
    rimDirection: RelightRimDirection
    extraPrompt: string
  }
  smart: {
    preset: RelightSmartPreset
    prompt: string
    lightingReferenceImages: string[]
  }
}

export interface RelightRoutePreparation {
  compatible: boolean
  reasons: string[]
  mode: RelightMode
  model: ModelDefinition | null
  params: DynamicValueMap
  prompt: string
  templateVersion: string
}

export interface RelightGenerationInput {
  route: RelightRoutePreparation & { model: ModelDefinition }
  params: DynamicValueMap
  upstream: { images: string[]; videos: []; audios: [] }
}

export const DEFAULT_RELIGHT_SETTINGS: RelightSettingsV1 = {
  relightContractVersion: RELIGHT_CONTRACT_VERSION,
  lightingMode: 'manual',
  manual: {
    keyDirection: 'none',
    brightness: 0,
    colorPreset: 'neutral',
    rimDirection: 'off',
    extraPrompt: '',
  },
  smart: {
    preset: 'natural-studio',
    prompt: '',
    lightingReferenceImages: [],
  },
}

export const RELIGHT_MANUAL_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['ic-light-v2'],
  requiredTags: ['image-to-image', 'supports-image-editing', 'relighting'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [{ providerId: 'fal' }],
  semanticRequirements: {
    referenceImages: { min: 1, max: 1 },
    outputCount: 1,
  },
} as const satisfies CanvasImageCapabilityModelPolicy

export const RELIGHT_SMART_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['gpt-image-2'],
  requiredTags: ['image-to-image', 'supports-image-editing'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [
    { providerId: 'fal' },
    { providerId: 'apimart', allowedChannels: ['ext', 'official'] },
    { providerId: 'kie' },
    { providerId: 'grsai', allowedChannels: ['vip'] },
  ],
  semanticRequirements: {
    referenceImages: { min: 1, max: 2 },
    outputCount: 1,
    quality: 'medium',
  },
} as const satisfies CanvasImageCapabilityModelPolicy

function copyDefaults(): RelightSettingsV1 {
  return {
    ...DEFAULT_RELIGHT_SETTINGS,
    manual: { ...DEFAULT_RELIGHT_SETTINGS.manual },
    smart: { ...DEFAULT_RELIGHT_SETTINGS.smart, lightingReferenceImages: [] },
  }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function boundedPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 32 * 1024) : ''
}

/** 项目载入和编辑器打开共用的唯一规范化入口。 */
export function normalizeRelightSettings(value: unknown): RelightSettingsV1 {
  if (!value || typeof value !== 'object') return copyDefaults()
  const raw = value as Record<string, unknown>
  if (raw.relightContractVersion !== undefined && raw.relightContractVersion !== 1) {
    throw new Error(`不支持的打光契约版本：${String(raw.relightContractVersion)}`)
  }
  const manual = raw.manual && typeof raw.manual === 'object'
    ? raw.manual as Record<string, unknown>
    : {}
  const smart = raw.smart && typeof raw.smart === 'object'
    ? raw.smart as Record<string, unknown>
    : {}
  const references = Array.isArray(smart.lightingReferenceImages)
    ? smart.lightingReferenceImages.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []
  if (references.length > 1) {
    throw new Error('智能打光最多支持 1 张光照参考图')
  }

  return {
    relightContractVersion: 1,
    lightingMode: enumValue(raw.lightingMode, ['manual', 'smart'] as const, 'manual'),
    manual: {
      keyDirection: enumValue(manual.keyDirection, RELIGHT_KEY_DIRECTIONS, 'none'),
      brightness: RELIGHT_BRIGHTNESS_LEVELS.includes(manual.brightness as RelightBrightness)
        ? manual.brightness as RelightBrightness
        : 0,
      colorPreset: enumValue(manual.colorPreset, RELIGHT_COLOR_PRESETS, 'neutral'),
      rimDirection: enumValue(manual.rimDirection, RELIGHT_RIM_DIRECTIONS, 'off'),
      extraPrompt: boundedPrompt(manual.extraPrompt),
    },
    smart: {
      preset: enumValue(smart.preset, RELIGHT_SMART_PRESETS, 'natural-studio'),
      prompt: boundedPrompt(smart.prompt),
      lightingReferenceImages: [...references],
    },
  }
}

const BRIGHTNESS_PROMPTS: Record<RelightBrightness, string> = {
  [-2]: 'very low-key lighting, substantially darker illumination while retaining readable subject detail',
  [-1]: 'slightly darker low-key lighting',
  0: 'balanced natural exposure',
  1: 'brighter illumination with controlled highlights',
  2: 'high-key bright illumination without clipping important details',
}

const COLOR_PROMPTS: Record<RelightColorPreset, string> = {
  neutral: 'neutral white illumination',
  warm: 'warm white illumination',
  cool: 'cool white illumination',
  amber: 'amber key-light tint',
  red: 'red key-light tint',
  blue: 'blue key-light tint',
  cyan: 'cyan key-light tint',
  magenta: 'magenta key-light tint',
}

const SMART_PRESET_PROMPTS: Record<RelightSmartPreset, string> = {
  'natural-studio': 'natural studio lighting with a soft key, gentle fill, and believable contact shadows',
  'soft-window': 'soft window light with broad highlights and gradual, natural shadow transitions',
  'golden-hour': 'warm golden-hour illumination with long soft shadows and restrained amber atmosphere',
  overcast: 'diffuse overcast daylight with low contrast and soft, even shadows',
  'hard-studio': 'hard studio key light with crisp intentional shadows and controlled highlights',
  moonlight: 'cool moonlit night illumination while retaining readable subject detail',
  neon: 'cinematic neon lighting with controlled colored reflections and preserved material detail',
  dramatic: 'dramatic low-key cinematic lighting with strong shape definition and coherent shadows',
}

export function compileManualRelightPrompt(settings: RelightSettingsV1): string {
  const normalized = normalizeRelightSettings(settings)
  const rim = normalized.manual.rimDirection === 'off'
    ? 'no additional rim light request'
    : `subtle rim light from the ${normalized.manual.rimDirection} image-relative direction; keep it secondary to the key light`
  const user = normalized.manual.extraPrompt
    ? `\n\n[用户补充]\n${normalized.manual.extraPrompt}`
    : ''
  return `[任务]\n仅对输入图像重新打光。保留原始主体身份、五官、姿势、轮廓、物体几何、构图、镜头和核心材质，不新增或删除对象。\n\n[亮度意图]\n${BRIGHTNESS_PROMPTS[normalized.manual.brightness]}\n\n[主光色调]\n${COLOR_PROMPTS[normalized.manual.colorPreset]}\n\n[轮廓光]\n${rim}${user}\n\n[负面约束]\n不改变背景布局，不改变衣着、产品标志、文字、手部或边缘细节，不生成第二个主体。`
}

export function compileSmartRelightPrompt(settings: RelightSettingsV1): string {
  const normalized = normalizeRelightSettings(settings)
  const user = normalized.smart.prompt ? `\n\n[用户要求]\n${normalized.smart.prompt}` : ''
  const reference = normalized.smart.lightingReferenceImages.length > 0
    ? '\n\n[光照参考]\n图像 2 只提供光源方向、软硬、强弱、颜色和氛围参考；不要复制它的主体、背景、构图或文字。'
    : ''
  return `[源图角色]\n图像 1 是要保留内容的源图。保留其主体身份、五官、姿势、物体几何、构图、镜头、背景布局、文字和标志。\n\n[打光任务]\n仅改变照明、阴影、反射与由光照带来的氛围。\n\n[预设]\n${SMART_PRESET_PROMPTS[normalized.smart.preset]}${user}${reference}\n\n[输出约束]\n输出一张与源图同构图、可继续编辑的普通图片；不添加边框、分栏、水印或说明文字。`
}

export function relightDirectionToFal(direction: RelightKeyDirection): string {
  return ({ none: 'None', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' })[direction]
}

export function prepareRelightRoute(
  settingsValue: unknown,
  imageModels: readonly ModelDefinition[],
  currentParams: DynamicValueMap = {},
): RelightRoutePreparation {
  let settings: RelightSettingsV1
  try {
    settings = normalizeRelightSettings(settingsValue)
  } catch (error) {
    return {
      compatible: false,
      reasons: [error instanceof Error ? error.message : '打光设置无效'],
      mode: 'manual',
      model: null,
      params: {},
      prompt: '',
      templateVersion: RELIGHT_MANUAL_TEMPLATE_VERSION,
    }
  }

  const policy = settings.lightingMode === 'manual'
    ? RELIGHT_MANUAL_MODEL_POLICY
    : RELIGHT_SMART_MODEL_POLICY
  const candidates = resolveCanvasCapabilityModelCandidates(imageModels, policy).candidates
  const preferred = settings.lightingMode === 'smart'
    ? ['fal', 'apimart', 'kie', 'grsai']
        .map((provider) => candidates.find((candidate) => candidate.model.meta.provider === provider))
        .find(Boolean)
    : candidates[0]
  if (!preferred) {
    return {
      compatible: false,
      reasons: [settings.lightingMode === 'manual'
        ? 'Fal IC-Light v2 当前不可用，请配置 Fal 或显式切换到智能模式'
        : '当前没有已配置的 GPT Image 2 编辑模型'],
      mode: settings.lightingMode,
      model: null,
      params: {},
      prompt: '',
      templateVersion: settings.lightingMode === 'manual'
        ? RELIGHT_MANUAL_TEMPLATE_VERSION
        : RELIGHT_SMART_TEMPLATE_VERSION,
    }
  }

  const mapped = mapCanvasCapabilityModelParams(preferred.model, policy, currentParams)
  const prompt = settings.lightingMode === 'manual'
    ? compileManualRelightPrompt(settings)
    : compileSmartRelightPrompt(settings)
  const params = { ...mapped.params }
  if (settings.lightingMode === 'manual') {
    params.falIcLightV2InitialLatent = relightDirectionToFal(settings.manual.keyDirection)
  }
  delete params.output_format
  delete params.outputFormat
  return {
    compatible: mapped.compatible,
    reasons: mapped.reasons.map((reason) => reason.message),
    mode: settings.lightingMode,
    model: preferred.model,
    params,
    prompt,
    templateVersion: settings.lightingMode === 'manual'
      ? RELIGHT_MANUAL_TEMPLATE_VERSION
      : RELIGHT_SMART_TEMPLATE_VERSION,
  }
}

/**
 * 节点执行器和无付费测试共用的最终请求映射。
 * 源图始终是图像 1；只有智能模式可在图像 2 携带一张光照参考。
 */
export function prepareRelightGenerationInput(
  settingsValue: unknown,
  imageModels: readonly ModelDefinition[],
  sourceImages: readonly string[],
  currentParams: DynamicValueMap = {},
): RelightGenerationInput {
  const sources = sourceImages.filter((item) => typeof item === 'string' && item.trim())
  if (sources.length !== 1) {
    throw new Error('图片打光必须且只能连接或上传 1 张源图')
  }
  const settings = normalizeRelightSettings(settingsValue)
  const route = prepareRelightRoute(settings, imageModels, currentParams)
  if (!route.compatible || !route.model) {
    throw new Error(route.reasons.join('；') || '当前打光模型不可用')
  }
  const references = settings.lightingMode === 'smart'
    ? settings.smart.lightingReferenceImages
    : []
  const images = [sources[0], ...references]
  return {
    route: { ...route, model: route.model },
    params: {
      ...route.params,
      prompt: route.prompt,
      text: route.prompt,
      images,
      uploadedFilePaths: images,
    },
    upstream: { images, videos: [], audios: [] },
  }
}

export function summarizeRelightSettings(settingsValue: unknown): string {
  const settings = normalizeRelightSettings(settingsValue)
  if (settings.lightingMode === 'smart') {
    return `智能 · ${settings.smart.preset}${settings.smart.lightingReferenceImages.length ? ' · 参考光感' : ''}`
  }
  return `手动 · ${settings.manual.keyDirection} · 亮度 ${settings.manual.brightness > 0 ? '+' : ''}${settings.manual.brightness} · ${settings.manual.colorPreset}`
}
