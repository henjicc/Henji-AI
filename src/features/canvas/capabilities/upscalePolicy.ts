import type { CanvasImageCapabilityModelPolicy } from './types'

/** 统一注册表选择默认高清模型时使用的稳定 canonical ID。 */
export const UPSCALE_DEFAULT_CANONICAL_MODEL_ID = 'topaz-image-upscale'

export const UPSCALE_OUTPUT_MAX_MEGAPIXELS = 48
export const UPSCALE_INPUT_MAX_FILE_BYTES = 20 * 1024 * 1024
export const UPSCALE_FACTORS = [2, 4] as const

export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number]

export interface UpscaleImageInfo {
  width: number
  height: number
  fileSizeBytes: number
  orientation: number | null
  hasAlpha: boolean
}

export interface UpscalePreflightResult {
  factor: UpscaleFactor
  sourceWidth: number
  sourceHeight: number
  sourceMegapixels: number
  outputWidth: number
  outputHeight: number
  outputMegapixels: number
  estimatedPriceUsd: 0.08 | 0.16
  pricingTier: 'up-to-24mp' | 'up-to-48mp'
  runtimeParams: {
    __falTopazOutputMegapixels: number
  }
}

export const UPSCALE_MODEL_POLICY = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['topaz-image-upscale'],
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

function normalizeFactor(value: unknown): UpscaleFactor {
  const factor = Number(value)
  if (!UPSCALE_FACTORS.includes(factor as UpscaleFactor)) {
    throw new Error('高清放大倍率必须是 2× 或 4×')
  }
  return factor as UpscaleFactor
}

/**
 * 高清任务提交前的唯一像素、文件、透明度与费用预检。
 *
 * 输出尺寸按 EXIF 方向修正后的视觉宽高计算；结果仅允许进入 Fal 官方
 * 24MP / 48MP 两个可精确报价的阶梯。该函数不发起上传或供应商请求。
 */
export function prepareUpscalePreflight(
  imageInfo: UpscaleImageInfo,
  factorValue: unknown,
): UpscalePreflightResult {
  const rawWidth = normalizeDimension(imageInfo.width, '宽度')
  const rawHeight = normalizeDimension(imageInfo.height, '高度')
  const factor = normalizeFactor(factorValue)
  if (!Number.isSafeInteger(imageInfo.fileSizeBytes) || imageInfo.fileSizeBytes <= 0) {
    throw new Error('无法读取源图文件大小，请重新导入有效图片')
  }
  if (imageInfo.fileSizeBytes > UPSCALE_INPUT_MAX_FILE_BYTES) {
    throw new Error('源图文件超过 20MiB，尚未上传或创建付费任务')
  }
  if (imageInfo.hasAlpha) {
    throw new Error('当前高清服务输出为 JPEG，暂不支持包含透明通道的源图')
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
  if (outputMegapixels > UPSCALE_OUTPUT_MAX_MEGAPIXELS) {
    throw new Error(
      `预计输出 ${outputWidth}×${outputHeight}（${outputMegapixels.toFixed(2)}MP），超过首版 48MP 上限，尚未上传或创建付费任务`,
    )
  }

  const upTo24Mp = outputMegapixels <= 24
  return {
    factor,
    sourceWidth,
    sourceHeight,
    sourceMegapixels,
    outputWidth,
    outputHeight,
    outputMegapixels,
    estimatedPriceUsd: upTo24Mp ? 0.08 : 0.16,
    pricingTier: upTo24Mp ? 'up-to-24mp' : 'up-to-48mp',
    runtimeParams: {
      __falTopazOutputMegapixels: outputMegapixels,
    },
  }
}
