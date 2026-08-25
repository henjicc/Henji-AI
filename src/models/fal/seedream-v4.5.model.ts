/**
 * Seedream V4.5 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import {
  calculateSeedreamSizeFromRatio,
  getImageSize,
  normalizeSeedreamCustomSize,
  resolveSeedreamRatio,
  type SeedreamResolutionValue,
} from '@/models/shared/seedreamResolution'

const FAL_SEEDREAM_V45_CONSTRAINTS = {
  minSide: 1920,
  maxSide: 4096,
  minPixels: 3686400,
  maxPixels: 16777216,
}

async function resolveFalSeedreamV45Size(
  resolution: SeedreamResolutionValue | undefined,
  images: string[]
): Promise<{ width: number; height: number }> {
  if (!resolution) {
    return { width: 2048, height: 2048 }
  }

  if (resolution.width && resolution.height) {
    return normalizeSeedreamCustomSize(
      resolution.width,
      resolution.height,
      FAL_SEEDREAM_V45_CONSTRAINTS
    )
  }

  let targetImageRatio: number | null = null
  if (resolution.aspectRatio === 'smart' && images.length > 0) {
    try {
      const imageSize = await getImageSize(images[0])
      if (imageSize.width > 0 && imageSize.height > 0) {
        targetImageRatio = imageSize.width / imageSize.height
      }
    } catch {
      targetImageRatio = null
    }
  }

  const resolvedRatio = resolveSeedreamRatio(resolution.aspectRatio, targetImageRatio)
  const quality = resolution.quality === '4K' ? '4K' : '2K'

  return calculateSeedreamSizeFromRatio(
    resolvedRatio,
    quality,
    FAL_SEEDREAM_V45_CONSTRAINTS
  )
}

export const seedreamV45Model = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedream-v4.5',
    canonicalModelId: 'seedream-4.5',
    seriesId: 'seedream',
    seriesRank: 4.5,
    provider: 'fal',
    type: 'image',
    i18nScope: 'models.defs.fal-ai-bytedance-seedream-v4.5',
    name: { key: 'meta.name', fallback: 'Seedream V4.5' },
    tags: ['image', 'text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-10'],
  },
  inputLimits: {
    images: { max: 10 },
    videos: { max: 0 },
  },
  runtimeConstraints: {
    imageSizeFields: [
      {
        field: 'image_size',
        format: 'object',
        widthKey: 'width',
        heightKey: 'height',
        minSide: 1920,
        maxSide: 4096,
        minPixels: 3686400,
        maxPixels: 16777216,
      },
    ],
  },
  params: [
    {
      id: 'falSeedreamV45AspectRatio',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' },
        { value: '16:9', label: '16:9' },
        { value: '3:2', label: '3:2' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '2:3', label: '2:3' },
        { value: '9:16', label: '9:16' },
      ],
    },
    {
      id: 'falSeedreamV45Resolution',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '2K',
      options: [
        { value: '2K', label: sharedOptionText('2k') },
        { value: '4K', label: sharedOptionText('4k') },
      ],
    },
    {
      id: 'falSeedream45NumImages',
      order: 3,
      type: 'number',
      name: sharedFieldText('numberOfImages'),
      default: 1,
      min: 1,
      max: 6,
    },
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths)
        ? (params.uploadedFilePaths as string[]).filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const images = uploaded.length > 0
        ? uploaded
        : (Array.isArray(params.images) ? (params.images as string[]) : [])
      return images.length > 0
        ? 'fal-ai/bytedance/seedream/v4.5/edit'
        : 'fal-ai/bytedance/seedream/v4.5/text-to-image'
    },
  },
  request: {
    builder: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths)
        ? (params.uploadedFilePaths as string[]).filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
      const images = uploaded.length > 0
        ? uploaded
        : (Array.isArray(params.images) ? (params.images as string[]) : [])
      const prompt = String(params.prompt || '')
      const numImages = Number(params.falSeedream45NumImages || 1)
      const legacyResolution = params.falSeedreamV45Resolution && typeof params.falSeedreamV45Resolution === 'object'
        ? params.falSeedreamV45Resolution as SeedreamResolutionValue
        : undefined
      const aspectRatio = legacyResolution?.aspectRatio ?? String(params.falSeedreamV45AspectRatio || 'smart')
      const quality = legacyResolution?.quality === '4K' || params.falSeedreamV45Resolution === '4K'
        ? '4K'
        : '2K'

      const imageSize = await resolveFalSeedreamV45Size(
        legacyResolution ?? { aspectRatio, quality },
        images
      )

      const requestData: DynamicValueMap = {
        prompt,
        image_size: imageSize,
        num_images: numImages,
        enable_safety_checker: false,
      }

      if (images.length > 0) {
        requestData.image_urls = images
      }

      return requestData
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const numImages = params.falSeedream45NumImages || 1
      return 0.04 * numImages
    },
    description: '$0.04/张',
  },
})

export default seedreamV45Model
