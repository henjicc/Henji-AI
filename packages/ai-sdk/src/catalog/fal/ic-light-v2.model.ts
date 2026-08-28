import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { falOneMegapixelSize } from './imageSizing'

const IC_LIGHT_DIRECTIONS = ['None', 'Left', 'Right', 'Top', 'Bottom'] as const

function cleanImages(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function nearestRatioText(ratio: number): string {
  const candidates = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
  return candidates.reduce((best, candidate) => {
    const [width, height] = candidate.split(':').map(Number)
    const [bestWidth, bestHeight] = best.split(':').map(Number)
    return Math.abs(width / height - ratio) < Math.abs(bestWidth / bestHeight - ratio)
      ? candidate
      : best
  }, '1:1' as (typeof candidates)[number])
}

export const falIcLightV2Model = defineModel({
  meta: {
    id: 'fal-ai-ic-light-v2',
    canonicalModelId: 'ic-light-v2',
    seriesId: 'ic-light',
    seriesRank: 2,
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'supports-image-editing', 'relighting', 'provider-fal'],
    aliases: ['ic-light-v2-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falIcLightV2InitialLatent',
      type: 'dropdown',
      order: 1,
      default: 'None',
      options: IC_LIGHT_DIRECTIONS.map((value) => ({ value })),
    },
  ],
  endpoints: {
    selector: async () => 'fal-ai/iclight-v2',
  },
  request: {
    builder: (params) => {
      const uploaded = cleanImages(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : cleanImages(params.images)
      if (images.length !== 1) {
        throw new Error('IC-Light v2 必须且只能提供 1 张源图')
      }

      const rawDirection = String(params.falIcLightV2InitialLatent || 'None')
      const direction = IC_LIGHT_DIRECTIONS.includes(rawDirection as (typeof IC_LIGHT_DIRECTIONS)[number])
        ? rawDirection
        : 'None'
      const ratio = typeof params.__firstImageRatio === 'number'
        && Number.isFinite(params.__firstImageRatio)
        && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1

      return {
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 32000) : '',
        image_url: images[0],
        initial_latent: direction,
        image_size: falOneMegapixelSize(nearestRatioText(ratio)),
        num_images: 1,
        num_inference_steps: 28,
        cfg_scale: 1,
        guidance_scale: 5,
        lowres_denoise: 0.98,
        highres_denoise: 0.95,
        highres_scale: 0.5,
        enable_hr_fix: false,
        enable_safety_checker: true,
      } satisfies JsonObject
    },
  },
  pricing: {
    currency: '$',
    calculator: () => 0.1,
    description: '$0.10/百万像素；首版固定约 1MP、1 张输出，估算 $0.10/次',
  },
})

export default falIcLightV2Model
