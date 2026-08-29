import { defineModel } from '../../../catalog/defineModel'

export const fluxProEraseModel = defineModel({
  meta: {
    id: 'fal-flux-pro-erase',
    canonicalModelId: 'flux-pro-erase',
    provider: 'fal',
    type: 'image',
    tags: ['image-edit', 'erase', 'mask-input', 'provider-fal'],
    polling: { interval: 2_000, maxAttempts: 180, expectedAttempts: 20 },
  },
  acceptsPrompt: false,
  inputLimits: { images: { exact: 2 }, videos: { max: 0 } },
  requirements: [{
    id: 'fal-flux-pro-erase-media',
    require: { images: { exact: 2 } },
    message: { title: '需要原图和遮罩', message: '请提供原图与同尺寸黑白遮罩。', type: 'error' },
  }],
  params: [
    { id: 'image', type: 'image-upload', order: 1, required: true, valueType: 'array', default: [], maxCount: 1 },
    { id: 'mask', type: 'image-upload', order: 2, required: true, valueType: 'array', default: [], maxCount: 1 },
  ],
  runtimeConstraints: {
    mediaFields: [{ field: 'image_url', kind: 'image' }, { field: 'mask_url', kind: 'image' }],
  },
  endpoints: 'fal-ai/flux-pro/v1/erase',
  request: {
    builder: (params) => ({
      image_url: firstMedia(params.image),
      mask_url: firstMedia(params.mask),
      dilate_pixels: 10,
    }),
  },
  pricing: {
    currency: '$',
    fixed: 0.042,
    description: '最低约 $0.042：首个生成 MP $0.03，后续生成 MP $0.004；参考图 $0.004/MP，至少按 3 MP',
  },
})

function firstMedia(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

export default fluxProEraseModel
