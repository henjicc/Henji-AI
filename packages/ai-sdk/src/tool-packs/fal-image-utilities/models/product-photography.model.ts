import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import {
  FAL_IMAGE_APP_RATIO_OPTIONS,
  requireSingleUtilityImage,
  resolveImageAppRatio,
} from '../shared'

export const falProductPhotographyModel = defineModel({
  meta: {
    id: 'fal-image-apps-v2-product-photography',
    canonicalModelId: 'image-apps-v2-product-photography',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'product-photography', 'background-generation', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  acceptsPrompt: false,
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-product-photography-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张商品图', message: '商品摄影必须且只能提供 1 张商品图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    {
      id: 'aspectRatio',
      type: 'aspect-ratio',
      order: 2,
      default: 'smart',
      options: FAL_IMAGE_APP_RATIO_OPTIONS.map((value) => ({ value })),
    },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'product_image_url', kind: 'image' }],
  },
  endpoints: 'fal-ai/image-apps-v2/product-photography',
  request: {
    builder: (params) => ({
      product_image_url: requireSingleUtilityImage(params, 'Fal 商品摄影'),
      aspect_ratio: { ratio: resolveImageAppRatio(params) },
    } satisfies JsonObject),
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/张' },
})

export default falProductPhotographyModel
