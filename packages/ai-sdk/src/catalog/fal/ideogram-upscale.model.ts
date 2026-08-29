import { defineModel } from '../defineModel'
import { requireSingleUpscaleImage } from './imageUpscale'

function clampInteger(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : fallback
}

export const falIdeogramUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-ideogram-upscale',
    canonicalModelId: 'ideogram-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  acceptsPrompt: false,
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falIdeogramUpscaleResemblance',
      type: 'number',
      order: 1,
      transferKey: 'upscaleResemblance',
      min: 1,
      max: 100,
      step: 1,
      default: 50,
    },
    {
      id: 'falIdeogramUpscaleDetail',
      type: 'number',
      order: 2,
      transferKey: 'upscaleDetail',
      min: 1,
      max: 100,
      step: 1,
      default: 50,
    },
  ],
  endpoints: { selector: async () => 'fal-ai/ideogram/upscale' },
  request: {
    builder: (params) => ({
      image_url: requireSingleUpscaleImage(params, 'Ideogram 图片放大'),
      resemblance: clampInteger(params.falIdeogramUpscaleResemblance, 50),
      detail: clampInteger(params.falIdeogramUpscaleDetail, 50),
    }),
  },
  pricing: { currency: '$', fixed: 0.06, description: '$0.06/张，最高约 2× 放大' },
})

export default falIdeogramUpscaleModel
