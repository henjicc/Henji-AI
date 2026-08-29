import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import {
  FAL_IMAGE_APP_RATIO_OPTIONS,
  booleanValue,
  requireSingleUtilityImage,
  resolveImageAppRatio,
} from '../shared'

export const falPhotoRestorationModel = defineModel({
  meta: {
    id: 'fal-image-apps-v2-photo-restoration',
    canonicalModelId: 'image-apps-v2-photo-restoration',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'photo-restoration', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-photo-restoration-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张旧照片', message: '照片修复必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'enhanceResolution', type: 'switch', order: 2, default: true },
    { id: 'fixColors', type: 'switch', order: 3, default: true },
    { id: 'removeScratches', type: 'switch', order: 4, default: true },
    {
      id: 'aspectRatio',
      type: 'aspect-ratio',
      order: 5,
      default: 'smart',
      options: FAL_IMAGE_APP_RATIO_OPTIONS.map((value) => ({ value })),
    },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
  },
  endpoints: 'fal-ai/image-apps-v2/photo-restoration',
  request: {
    builder: (params) => {
      const image = requireSingleUtilityImage(params, 'Fal 照片修复')
      const enhanceResolution = booleanValue(params.enhanceResolution, true)
      const fixColors = booleanValue(params.fixColors, true)
      const removeScratches = booleanValue(params.removeScratches, true)
      if (!enhanceResolution && !fixColors && !removeScratches) {
        throw new Error('Fal 照片修复至少需要开启一项修复能力')
      }

      return {
        image_url: image,
        enhance_resolution: enhanceResolution,
        fix_colors: fixColors,
        remove_scratches: removeScratches,
        aspect_ratio: { ratio: resolveImageAppRatio(params) },
      } satisfies JsonObject
    },
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/张' },
})

export default falPhotoRestorationModel
