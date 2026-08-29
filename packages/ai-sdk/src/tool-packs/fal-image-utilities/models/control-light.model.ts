import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import { clampNumber, requireSingleUtilityImage } from '../shared'

export const falControlLightModel = defineModel({
  meta: {
    id: 'fal-control-light',
    canonicalModelId: 'control-light',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'low-light-enhancement', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-control-light-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张暗光图片', message: '暗光增强必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'lightingLevel', type: 'number', order: 2, default: 0.75, min: 0, max: 1, step: 0.05 },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
    numberFields: [{ field: 'lighting_level', min: 0, max: 1, fallback: 0.75 }],
  },
  endpoints: 'fal-ai/control-light',
  request: {
    builder: (params) => ({
      image_url: requireSingleUtilityImage(params, 'Fal 暗光增强'),
      lighting_level: clampNumber(params.lightingLevel, 0, 1, 0.75),
    } satisfies JsonObject),
  },
  pricing: {
    currency: '$',
    calculator: () => 0.03,
    description: '$0.03/百万像素；首版按 1MP 明示估算 $0.03/次',
  },
})

export default falControlLightModel
