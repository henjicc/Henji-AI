import { defineModel } from '../../../catalog/defineModel'
import type { JsonObject } from '../../../types/runtime'
import { clampInteger, clampNumber, requireSingleUtilityImage } from '../shared'

export const falOutpaintModel = defineModel({
  meta: {
    id: 'fal-image-apps-v2-outpaint',
    canonicalModelId: 'image-apps-v2-outpaint',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'outpainting', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 30 },
  },
  inputLimits: { images: { exact: 1 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-outpaint-source',
    require: { images: { exact: 1 } },
    message: { title: '需要单张源图', message: '扩图必须且只能提供 1 张源图。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'expandLeft', type: 'number', order: 2, default: 0, min: 0, max: 700, step: 1 },
    { id: 'expandRight', type: 'number', order: 3, default: 0, min: 0, max: 700, step: 1 },
    { id: 'expandTop', type: 'number', order: 4, default: 0, min: 0, max: 700, step: 1 },
    { id: 'expandBottom', type: 'number', order: 5, default: 0, min: 0, max: 700, step: 1 },
    { id: 'zoomOutPercentage', type: 'number', order: 6, default: 20, min: 0, max: 90, step: 1 },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }],
    numberFields: [
      { field: 'expand_left', min: 0, max: 700, integer: true, fallback: 0 },
      { field: 'expand_right', min: 0, max: 700, integer: true, fallback: 0 },
      { field: 'expand_top', min: 0, max: 700, integer: true, fallback: 0 },
      { field: 'expand_bottom', min: 0, max: 700, integer: true, fallback: 0 },
      { field: 'zoom_out_percentage', min: 0, max: 90, fallback: 20 },
    ],
  },
  endpoints: 'fal-ai/image-apps-v2/outpaint',
  request: {
    builder: (params) => {
      const image = requireSingleUtilityImage(params, 'Fal 扩图')
      const expandLeft = clampInteger(params.expandLeft, 0, 700, 0)
      const expandRight = clampInteger(params.expandRight, 0, 700, 0)
      const expandTop = clampInteger(params.expandTop, 0, 700, 0)
      const expandBottom = clampInteger(params.expandBottom, 0, 700, 0)
      const zoomOutPercentage = clampNumber(params.zoomOutPercentage, 0, 90, 20)
      if (expandLeft + expandRight + expandTop + expandBottom === 0 && zoomOutPercentage === 0) {
        throw new Error('Fal 扩图至少需要扩展一侧或设置大于 0 的缩小比例')
      }

      const body: JsonObject = {
        image_url: image,
        expand_left: expandLeft,
        expand_right: expandRight,
        expand_top: expandTop,
        expand_bottom: expandBottom,
        zoom_out_percentage: zoomOutPercentage,
      }
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 500) : ''
      if (prompt.length > 0) body.prompt = prompt
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: () => 0.035,
    description: '$0.035/百万像素；首版按 1MP 明示估算 $0.035/次',
  },
})

export default falOutpaintModel
