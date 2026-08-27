import { defineModel } from '../../../catalog/defineModel'

export const finegrainEraserModel = defineModel({
  meta: {
    id: 'fal-finegrain-eraser',
    canonicalModelId: 'finegrain-eraser',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'erase', 'mask-input', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 20 },
  },
  inputLimits: { images: { exact: 2 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-finegrain-eraser-media',
    require: { images: { exact: 2 } },
    message: { title: '需要原图和遮罩', message: '请提供原图与二值遮罩。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'mask', type: 'image-upload', order: 2, required: true, valueType: 'array', default: [], maxCount: 1 },
    {
      id: 'mode', type: 'dropdown', order: 3, default: 'standard',
      options: [{ value: 'express' }, { value: 'standard' }, { value: 'premium' }],
    },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }, { field: 'mask_url', kind: 'image' }],
    enumFields: [{ field: 'mode', allowed: ['express', 'standard', 'premium'], fallback: 'standard' }],
  },
  endpoints: 'fal-ai/finegrain-eraser/mask',
  request: {
    builder: (params) => ({
      image_url: firstMedia(params.image),
      mask_url: firstMedia(params.mask),
      mode: ['express', 'premium'].includes(String(params.mode)) ? String(params.mode) : 'standard',
    }),
  },
  pricing: {
    currency: '$',
    calculator: (params) => params.mode === 'express' ? 0.04 : params.mode === 'premium' ? 0.22 : 0.13,
    description: 'Express $0.04 / Standard $0.13 / Premium $0.22',
  },
})

function firstMedia(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

export default finegrainEraserModel
