import { defineModel } from '../defineModel'
import { requireSingleUpscaleImage } from './imageUpscale'

export const falBriaCreativeUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-bria-creative-upscale',
    canonicalModelId: 'bria-creative-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'alpha-preserving', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falBriaPreserveAlpha',
      type: 'switch',
      order: 1,
      transferKey: 'preserveAlpha',
      default: true,
    },
  ],
  endpoints: { selector: async () => 'bria/upscale/creative' },
  request: {
    builder: (params) => ({
      image_url: requireSingleUpscaleImage(params, 'Bria 创意放大'),
      preserve_alpha: params.falBriaPreserveAlpha !== false,
    }),
  },
  pricing: { currency: '$', fixed: 0.04, description: '$0.04/张，固定约 2×，输出最高 10MP' },
})

export default falBriaCreativeUpscaleModel
