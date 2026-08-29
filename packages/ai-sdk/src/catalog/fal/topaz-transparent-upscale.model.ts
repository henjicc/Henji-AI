import { defineModel } from '../defineModel'
import { pricePerStartedMegapixels, requireSingleUpscaleImage } from './imageUpscale'

export const falTopazTransparentUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-topaz-transparent-upscale',
    canonicalModelId: 'topaz-transparent-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'alpha-preserving', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [],
  endpoints: { selector: async () => 'topaz/upscale/image/transparent' },
  request: {
    builder: (params) => ({
      image_url: requireSingleUpscaleImage(params, 'Topaz 透明图放大'),
    }),
  },
  pricing: {
    currency: '$',
    calculator: (params) => pricePerStartedMegapixels(params, 24, 0.08),
    description: '固定 4× 并保留透明通道；每开始 24MP 输出 $0.08',
  },
})

export default falTopazTransparentUpscaleModel
