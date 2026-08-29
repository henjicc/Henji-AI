import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import {
  pricePerStartedMegapixels,
  requireSingleUpscaleImage,
} from './imageUpscale'

export const FAL_TOPAZ_UPSCALE_MODES = ['precision', 'creative', 'generative'] as const
export const FAL_TOPAZ_PRECISION_MODELS = [
  'Standard V2',
  'High Fidelity V3',
  'High Fidelity V2',
  'Low Resolution V2',
  'CGI',
  'Text Refine',
] as const
export const FAL_TOPAZ_CREATIVE_MODELS = ['Bloom 2', 'Bloom', 'Bloom Realism'] as const
export const FAL_TOPAZ_GENERATIVE_MODELS = [
  'Wonder 3.5',
  'Wonder 3',
  'Wonder 2',
  'Wonder',
  'Recover 3',
  'Standard MAX',
  'Recovery V2',
  'Recovery',
] as const
export const FAL_TOPAZ_UPSCALE_FACTORS = [2, 4] as const

type TopazMode = (typeof FAL_TOPAZ_UPSCALE_MODES)[number]

function resolveChoice<T extends string | number>(
  value: JsonValue,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? value as T : fallback
}

function resolveMode(value: JsonValue): TopazMode {
  return resolveChoice(value, FAL_TOPAZ_UPSCALE_MODES, 'precision')
}

function estimateTopazPrice(params: JsonObject): number {
  const mode = resolveMode(params.falTopazUpscaleMode)
  if (mode === 'precision') return pricePerStartedMegapixels(params, 24, 0.08)
  if (mode === 'creative') return pricePerStartedMegapixels(params, 2, 0.08)
  const model = resolveChoice(
    params.falTopazGenerativeModel,
    FAL_TOPAZ_GENERATIVE_MODELS,
    'Wonder 3.5',
  )
  return pricePerStartedMegapixels(
    params,
    model === 'Wonder 3.5' || model === 'Wonder 3' ? 8 : 4,
    0.08,
  )
}

export const falTopazImageUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-topaz-image-upscale',
    canonicalModelId: 'topaz-image-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falTopazUpscaleMode',
      type: 'dropdown',
      order: 1,
      transferKey: 'upscaleMode',
      default: 'precision',
      options: FAL_TOPAZ_UPSCALE_MODES.map((value) => ({ value })),
    },
    {
      id: 'falTopazPrecisionModel',
      type: 'dropdown',
      order: 2,
      transferKey: 'upscalePrecisionModel',
      default: 'High Fidelity V3',
      options: FAL_TOPAZ_PRECISION_MODELS.map((value) => ({ value })),
      visible: { condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'precision' },
    },
    {
      id: 'falTopazCreativeModel',
      type: 'dropdown',
      order: 2,
      transferKey: 'upscaleCreativeModel',
      default: 'Bloom 2',
      options: FAL_TOPAZ_CREATIVE_MODELS.map((value) => ({ value })),
      visible: { condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'creative' },
    },
    {
      id: 'falTopazGenerativeModel',
      type: 'dropdown',
      order: 2,
      transferKey: 'upscaleGenerativeModel',
      default: 'Wonder 3.5',
      options: FAL_TOPAZ_GENERATIVE_MODELS.map((value) => ({ value })),
      visible: { condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'generative' },
    },
    {
      id: 'falTopazUpscaleFactor',
      type: 'dropdown',
      valueType: 'number',
      order: 3,
      transferKey: 'upscaleFactor',
      default: 2,
      options: FAL_TOPAZ_UPSCALE_FACTORS.map((value) => ({ value })),
    },
    {
      id: 'falTopazFaceEnhancement',
      type: 'switch',
      order: 4,
      transferKey: 'faceEnhancement',
      default: false,
      visible: { condition: (params) => resolveMode(params.falTopazUpscaleMode) !== 'creative' },
    },
    {
      id: 'falTopazCreativeStrength',
      type: 'number',
      order: 5,
      transferKey: 'upscaleCreativity',
      min: 1,
      max: 9,
      step: 1,
      default: 4,
      visible: {
        condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'creative'
          && params.falTopazCreativeModel === 'Bloom 2',
      },
    },
    {
      id: 'falTopazColorPreservation',
      type: 'switch',
      order: 6,
      transferKey: 'colorPreservation',
      default: true,
      visible: {
        condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'creative'
          && params.falTopazCreativeModel === 'Bloom 2',
      },
    },
    {
      id: 'falTopazEnhancementStrength',
      type: 'dropdown',
      order: 7,
      transferKey: 'enhancementStrength',
      default: 'medium',
      options: ['low', 'medium', 'high'].map((value) => ({ value })),
      visible: {
        condition: (params) => resolveMode(params.falTopazUpscaleMode) === 'generative'
          && (params.falTopazGenerativeModel === 'Wonder 3.5'
            || params.falTopazGenerativeModel === 'Wonder 3'),
      },
    },
  ],
  endpoints: {
    selector: async (params) => `topaz/upscale/image/${resolveMode(params.falTopazUpscaleMode)}`,
  },
  request: {
    builder: (params) => {
      const mode = resolveMode(params.falTopazUpscaleMode)
      const faceEnhancement = params.falTopazFaceEnhancement === true
      const body: JsonObject = {
        image_url: requireSingleUpscaleImage(params, 'Topaz 图片放大'),
        upscale_factor: resolveChoice(params.falTopazUpscaleFactor, FAL_TOPAZ_UPSCALE_FACTORS, 2),
        crop_to_fill: false,
      }

      if (mode === 'precision') {
        body.model = resolveChoice(
          params.falTopazPrecisionModel,
          FAL_TOPAZ_PRECISION_MODELS,
          'High Fidelity V3',
        )
        body.face_enhancement = faceEnhancement
      } else if (mode === 'creative') {
        const model = resolveChoice(params.falTopazCreativeModel, FAL_TOPAZ_CREATIVE_MODELS, 'Bloom 2')
        body.model = model
        if (model === 'Bloom 2') {
          body.creativity = Math.min(9, Math.max(1, Math.round(Number(params.falTopazCreativeStrength) || 4)))
          body.color_preservation = params.falTopazColorPreservation !== false
        }
      } else {
        const model = resolveChoice(
          params.falTopazGenerativeModel,
          FAL_TOPAZ_GENERATIVE_MODELS,
          'Wonder 3.5',
        )
        body.model = model
        body.face_enhancement = faceEnhancement
        if (model === 'Wonder 3.5' || model === 'Wonder 3') {
          body.enhancement_strength = resolveChoice(
            params.falTopazEnhancementStrength,
            ['low', 'medium', 'high'] as const,
            'medium',
          )
        }
      }

      if (faceEnhancement && mode !== 'creative') {
        body.face_enhancement_creativity = 0
        body.face_enhancement_strength = 0.8
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: estimateTopazPrice,
    description: '精确模式每开始 24MP $0.08；创意模式每开始 2MP $0.08；生成模式按子模型每开始 4MP 或 8MP $0.08',
  },
})

export default falTopazImageUpscaleModel
