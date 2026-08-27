import { defineModel } from '../../../catalog/defineModel'

export const briaEraserModel = defineModel({
  meta: {
    id: 'fal-bria-eraser',
    canonicalModelId: 'bria-eraser',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'erase', 'mask-input', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 20 },
  },
  inputLimits: { images: { exact: 2 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-bria-eraser-media',
    require: { images: { exact: 2 } },
    message: { title: '需要原图和遮罩', message: '请提供原图与用户绘制的二值遮罩。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'mask', type: 'image-upload', order: 2, required: true, valueType: 'array', default: [], maxCount: 1 },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }, { field: 'mask_url', kind: 'image' }],
  },
  endpoints: 'fal-ai/bria/eraser',
  request: {
    builder: (params) => ({
      image_url: firstMedia(params.image),
      mask_url: firstMedia(params.mask),
      mask_type: 'manual',
    }),
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/次' },
})

function firstMedia(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

export default briaEraserModel
