import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'

export const FAL_TOPAZ_PRECISION_MODELS = [
  'Standard V2',
  'High Fidelity V2',
  'Low Resolution V2',
  'CGI',
  'Text Refine',
] as const

export const FAL_TOPAZ_UPSCALE_FACTORS = [2, 4] as const

function cleanImages(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function resolvePrecisionModel(value: JsonValue): (typeof FAL_TOPAZ_PRECISION_MODELS)[number] {
  const candidate = String(value || '')
  return FAL_TOPAZ_PRECISION_MODELS.includes(candidate as (typeof FAL_TOPAZ_PRECISION_MODELS)[number])
    ? candidate as (typeof FAL_TOPAZ_PRECISION_MODELS)[number]
    : 'High Fidelity V2'
}

function resolveUpscaleFactor(value: JsonValue): (typeof FAL_TOPAZ_UPSCALE_FACTORS)[number] {
  const candidate = Number(value)
  return FAL_TOPAZ_UPSCALE_FACTORS.includes(candidate as (typeof FAL_TOPAZ_UPSCALE_FACTORS)[number])
    ? candidate as (typeof FAL_TOPAZ_UPSCALE_FACTORS)[number]
    : 2
}

function estimateTopazPrice(params: JsonObject): number {
  const megapixels = Number(params.__falTopazOutputMegapixels)
  if (!Number.isFinite(megapixels) || megapixels <= 0) return 0.16
  if (megapixels <= 24) return 0.08
  if (megapixels <= 48) return 0.16
  return 1.36
}

export const falTopazImageUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-topaz-image-upscale',
    canonicalModelId: 'topaz-image-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'provider-fal'],
    aliases: ['topaz-image-upscale-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falTopazUpscaleModel',
      type: 'dropdown',
      order: 1,
      default: 'High Fidelity V2',
      options: FAL_TOPAZ_PRECISION_MODELS.map((value) => ({ value })),
    },
    {
      id: 'falTopazUpscaleFactor',
      type: 'dropdown',
      valueType: 'number',
      order: 2,
      default: 2,
      options: FAL_TOPAZ_UPSCALE_FACTORS.map((value) => ({ value })),
    },
    {
      id: 'falTopazFaceEnhancement',
      type: 'switch',
      order: 3,
      default: false,
    },
  ],
  endpoints: {
    selector: async () => 'fal-ai/topaz/upscale/image',
  },
  request: {
    builder: (params) => {
      const uploaded = cleanImages(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : cleanImages(params.images)
      if (images.length !== 1) {
        throw new Error('Topaz 图片放大必须且只能提供 1 张源图')
      }

      const faceEnhancement = params.falTopazFaceEnhancement === true
      const body: JsonObject = {
        image_url: images[0],
        model: resolvePrecisionModel(params.falTopazUpscaleModel),
        upscale_factor: resolveUpscaleFactor(params.falTopazUpscaleFactor),
        crop_to_fill: false,
        subject_detection: 'All',
        face_enhancement: faceEnhancement,
      }

      if (faceEnhancement) {
        body.face_enhancement_creativity = 0
        body.face_enhancement_strength = 0.8
      }

      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: estimateTopazPrice,
    description: '按输出像素阶梯计费：不超过 24MP 为 $0.08，不超过 48MP 为 $0.16；首版提交前限制在 48MP 内',
  },
})

export default falTopazImageUpscaleModel
