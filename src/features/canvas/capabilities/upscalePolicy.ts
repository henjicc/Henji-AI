import type { ModelDefinition } from '@/core/types'
import type { CanvasImageCapabilityModelPolicy } from './types'

export const UPSCALE_DEFAULT_CANONICAL_MODEL_ID = 'topaz-image-upscale'

export interface UpscaleImageInfo {
  width: number
  height: number
  fileSizeBytes: number
  orientation: number | null
  hasAlpha: boolean
}

export interface UpscalePreflightResult {
  factor: number
  sourceWidth: number
  sourceHeight: number
  sourceMegapixels: number
  outputWidth: number
  outputHeight: number
  outputMegapixels: number
  runtimeParams: {
    __upscaleInputMegapixels: number
    __upscaleOutputMegapixels: number
  }
}

interface UpscalePreflightProfile {
  factor: { mode: 'fixed'; value: number } | { mode: 'parameter'; transferKey: string }
  allowedFactors?: readonly number[]
  maxInputFileBytes?: number
  maxOutputMegapixels?: number
  alpha: 'preserve' | 'reject'
}

const UPSCALE_PREFLIGHT_PROFILES: Readonly<Record<string, UpscalePreflightProfile>> = {
  'topaz-image-upscale': {
    factor: { mode: 'parameter', transferKey: 'upscaleFactor' },
    allowedFactors: [2, 4],
    maxInputFileBytes: 20 * 1024 * 1024,
    maxOutputMegapixels: 48,
    alpha: 'reject',
  },
  'topaz-transparent-upscale': {
    factor: { mode: 'fixed', value: 4 },
    maxInputFileBytes: 20 * 1024 * 1024,
    alpha: 'preserve',
  },
  'seedvr2-image-upscale': {
    factor: { mode: 'parameter', transferKey: 'upscaleFactor' },
    allowedFactors: [2, 4],
    alpha: 'reject',
  },
  'bria-creative-upscale': {
    factor: { mode: 'fixed', value: 2 },
    maxOutputMegapixels: 10,
    alpha: 'preserve',
  },
  'ideogram-upscale': {
    factor: { mode: 'fixed', value: 2 },
    alpha: 'reject',
  },
}

export const UPSCALE_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: Object.keys(UPSCALE_PREFLIGHT_PROFILES),
  requiredTags: ['image-to-image', 'upscaling'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [{ providerId: 'fal' }],
  semanticRequirements: {
    referenceImages: { min: 1, max: 1 },
    outputCount: 1,
  },
} as const satisfies CanvasImageCapabilityModelPolicy

function isOrientedQuarterTurn(orientation: number | null): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
}

function normalizeDimension(value: number, name: '宽度' | '高度'): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`无法读取源图${name}，请重新导入有效图片`)
  }
  return value
}

function resolveFactor(
  model: ModelDefinition,
  params: DynamicValueMap,
  profile: UpscalePreflightProfile,
): number {
  const factorProfile = profile.factor
  if (factorProfile.mode === 'fixed') return factorProfile.value
  const param = model.params.find((candidate) => candidate.transferKey === factorProfile.transferKey)
  const factor = Number(param ? params[param.id] ?? param.default : Number.NaN)
  if (!Number.isFinite(factor) || factor <= 0 || !profile.allowedFactors?.includes(factor)) {
    throw new Error('当前模型的放大倍率无效，请重新选择')
  }
  return factor
}

export function prepareUpscalePreflight(
  imageInfo: UpscaleImageInfo,
  model: ModelDefinition,
  params: DynamicValueMap,
): UpscalePreflightResult {
  const profile = UPSCALE_PREFLIGHT_PROFILES[model.meta.canonicalModelId]
  if (!profile) throw new Error('当前模型未通过高清放大预检')

  const rawWidth = normalizeDimension(imageInfo.width, '宽度')
  const rawHeight = normalizeDimension(imageInfo.height, '高度')
  const factor = resolveFactor(model, params, profile)
  if (!Number.isSafeInteger(imageInfo.fileSizeBytes) || imageInfo.fileSizeBytes <= 0) {
    throw new Error('无法读取源图文件大小，请重新导入有效图片')
  }
  if (profile.maxInputFileBytes && imageInfo.fileSizeBytes > profile.maxInputFileBytes) {
    const maxMiB = profile.maxInputFileBytes / 1024 / 1024
    throw new Error(`源图文件超过 ${maxMiB}MiB，尚未上传或创建付费任务`)
  }
  if (imageInfo.hasAlpha && profile.alpha === 'reject') {
    throw new Error('当前放大模型不保留透明通道，请改用 Topaz 透明图放大或 Bria')
  }

  const sourceWidth = isOrientedQuarterTurn(imageInfo.orientation) ? rawHeight : rawWidth
  const sourceHeight = isOrientedQuarterTurn(imageInfo.orientation) ? rawWidth : rawHeight
  const outputWidth = sourceWidth * factor
  const outputHeight = sourceHeight * factor
  if (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight)) {
    throw new Error('预计输出尺寸超出安全范围，尚未上传或创建付费任务')
  }
  const sourceMegapixels = sourceWidth * sourceHeight / 1_000_000
  const outputMegapixels = outputWidth * outputHeight / 1_000_000
  if (profile.maxOutputMegapixels && outputMegapixels > profile.maxOutputMegapixels) {
    throw new Error(
      `预计输出 ${outputWidth}×${outputHeight}（${outputMegapixels.toFixed(2)}MP），超过当前模型 ${profile.maxOutputMegapixels}MP 上限，尚未上传或创建付费任务`,
    )
  }

  return {
    factor,
    sourceWidth,
    sourceHeight,
    sourceMegapixels,
    outputWidth,
    outputHeight,
    outputMegapixels,
    runtimeParams: {
      __upscaleInputMegapixels: sourceMegapixels,
      __upscaleOutputMegapixels: outputMegapixels,
    },
  }
}
