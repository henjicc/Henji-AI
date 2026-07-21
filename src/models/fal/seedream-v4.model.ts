/**
 * Seedream V4 图片生成模型
 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import type { CompositePanelDef } from '@/core/types'
import {
  calculateSeedreamSizeFromRatio,
  getImageSize,
  normalizeSeedreamCustomSize,
  resolveSeedreamRatio,
  type SeedreamResolutionValue,
} from '@/models/shared/seedreamResolution'

const FAL_SEEDREAM_V4_CONSTRAINTS = {
  minSide: 1024,
  maxSide: 4096,
  maxPixels: 16777216,
}

async function resolveFalSeedreamV4Size(
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
      FAL_SEEDREAM_V4_CONSTRAINTS
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
    FAL_SEEDREAM_V4_CONSTRAINTS
  )
}

export const seedreamV4Model = defineModel({
  meta: {
    id: 'fal-ai-bytedance-seedream-v4',
    seriesId: 'seedream',
    seriesRank: 4.0,
    provider: 'fal',
    type: 'image',
    i18nScope: 'models.defs.fal-ai-bytedance-seedream-v4',
    name: { key: 'meta.name', fallback: 'Seedream V4' },
    description: 'Bytedance Seedream V4 图片生成模型',
    tags: ['image', 'text-to-image', 'image-to-image'],
  },
  runtimeConstraints: {
    imageSizeFields: [
      {
        field: 'image_size',
        format: 'object',
        widthKey: 'width',
        heightKey: 'height',
        minSide: 1024,
        maxSide: 4096,
        maxPixels: 16777216,
      },
    ],
  },
  params: [
    {
      id: 'falSeedreamV4Resolution',
      order: 1,
      type: 'composite',
      valueType: 'object',
      name: sharedFieldText('resolution'),
      panel: 'resolution',
      default: {
        mode: 'hybrid',
        aspectRatio: 'smart',
        quality: '2K',
        width: 2048,
        height: 2048,
      },
      config: {
        mode: 'hybrid',
        aspectRatios: {
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
          default: 'smart',
          smartMatch: true,
        },
        qualityTiers: {
          options: [
            { value: '2K', label: sharedOptionText('2k') },
            { value: '4K', label: sharedOptionText('4k') },
          ],
          default: '2K',
        },
        customSize: {
          enabled: true,
          minWidth: 1024,
          maxWidth: 4096,
          minHeight: 1024,
          maxHeight: 4096,
          step: 1,
          lockRatio: false,
        },
      },
    } as CompositePanelDef,
    {
      id: 'falSeedream40NumImages',
      order: 2,
      type: 'number',
      name: sharedFieldText('numberOfImages'),
      default: 1,
      min: 1,
      max: 6,
    },
  ],
  linkages: [
    {
      trigger: 'falSeedreamV4Resolution',
      effect: 'setValue',
      target: 'falSeedreamV4Resolution',
      condition: (triggerValue: SeedreamResolutionValue) => {
        return Boolean(
          triggerValue &&
          triggerValue.aspectRatio &&
          triggerValue.aspectRatio !== 'smart'
        )
      },
      value: (triggerValue: SeedreamResolutionValue) => {
        const ratio = resolveSeedreamRatio(triggerValue.aspectRatio, null)
        const quality = triggerValue.quality === '4K' ? '4K' : '2K'
        const size = calculateSeedreamSizeFromRatio(
          ratio,
          quality,
          FAL_SEEDREAM_V4_CONSTRAINTS
        )
        return {
          ...triggerValue,
          width: size.width,
          height: size.height,
        }
      },
    },
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0
        ? 'fal-ai/bytedance/seedream/v4/edit'
        : 'fal-ai/bytedance/seedream/v4/text-to-image'
    },
  },
  request: {
    builder: async (params) => {
      const images = Array.isArray(params.images) ? (params.images as string[]) : []
      const prompt = String(params.prompt || '')
      const numImages = Number(params.falSeedream40NumImages || 1)
      const resolutionValue = params.falSeedreamV4Resolution as SeedreamResolutionValue | undefined

      const imageSize = await resolveFalSeedreamV4Size(resolutionValue, images)

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
      const numImages = params.falSeedream40NumImages || 1
      return 0.015 * numImages
    },
    description: '基础价格 $0.015/张',
  },
})

export default seedreamV4Model
