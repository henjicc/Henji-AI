import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import {
  FAL_IMAGE_APP_RATIO_OPTIONS,
  requireSingleUtilityImage,
  resolveImageAppRatio,
} from '../shared'

export const FAL_RELIGHTING_STYLES = [
  'natural',
  'studio',
  'golden_hour',
  'blue_hour',
  'dramatic',
  'soft',
  'hard',
  'backlight',
  'side_light',
  'front_light',
  'rim_light',
  'sunset',
  'sunrise',
  'neon',
  'candlelight',
  'moonlight',
  'spotlight',
  'ambient',
] as const

export const falRelightingModel = defineModel({
  meta: {
    id: 'fal-image-apps-v2-relighting',
    canonicalModelId: 'image-apps-v2-relighting',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'relighting', 'style-presets', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-relighting-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张源图', message: '重打光必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    {
      id: 'lightingStyle',
      type: 'dropdown',
      order: 2,
      default: 'natural',
      options: FAL_RELIGHTING_STYLES.map((value) => ({ value })),
    },
    {
      id: 'aspectRatio',
      type: 'aspect-ratio',
      order: 3,
      default: 'smart',
      options: FAL_IMAGE_APP_RATIO_OPTIONS.map((value) => ({ value })),
    },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
    enumFields: [{ field: 'lighting_style', allowed: [...FAL_RELIGHTING_STYLES], fallback: 'natural' }],
  },
  endpoints: 'fal-ai/image-apps-v2/relighting',
  request: {
    builder: (params) => {
      const requestedStyle = String(params.lightingStyle || 'natural')
      const lightingStyle = FAL_RELIGHTING_STYLES.includes(
        requestedStyle as (typeof FAL_RELIGHTING_STYLES)[number],
      ) ? requestedStyle : 'natural'

      return {
        image_url: requireSingleUtilityImage(params, 'Fal 重打光'),
        lighting_style: lightingStyle,
        aspect_ratio: { ratio: resolveImageAppRatio(params) },
      } satisfies JsonObject
    },
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/张' },
})

export default falRelightingModel
