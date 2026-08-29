import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import { requireSingleUtilityImage } from '../shared'

export const falPixelcutBackgroundRemovalModel = defineModel({
  meta: {
    id: 'fal-pixelcut-background-removal',
    canonicalModelId: 'pixelcut-background-removal',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'background-removal', 'alpha-output', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  acceptsPrompt: false,
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-pixelcut-background-removal-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张图片', message: '背景移除必须且只能提供 1 张 JPEG 或 PNG 图片。', type: 'error' },
  }],
  params: [{
    id: 'image',
    type: 'image-upload',
    order: 1,
    required: true,
    valueType: 'array',
    default: [],
    maxCount: 1,
    accept: ['image/jpeg', 'image/png'],
  }],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
  },
  endpoints: 'pixelcut/background-removal',
  request: {
    builder: (params) => ({
      image_url: requireSingleUtilityImage(params, 'Fal Pixelcut 背景移除'),
      sync_mode: false,
    } satisfies JsonObject),
  },
  pricing: { currency: '$', fixed: 0.016, description: '$0.016/张' },
})

export default falPixelcutBackgroundRemovalModel
