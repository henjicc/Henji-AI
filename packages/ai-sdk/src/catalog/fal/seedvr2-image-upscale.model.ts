import { defineModel } from '../defineModel'
import { readUpscaleOutputMegapixels, requireSingleUpscaleImage } from './imageUpscale'

export const FAL_SEEDVR2_UPSCALE_FACTORS = [2, 4] as const

function clampNoiseScale(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.1
}

export const falSeedvr2ImageUpscaleModel = defineModel({
  meta: {
    id: 'fal-ai-seedvr2-image-upscale',
    canonicalModelId: 'seedvr2-image-upscale',
    provider: 'fal',
    type: 'image',
    tags: ['image-to-image', 'upscaling', 'provider-fal'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 },
  },
  inputLimits: { images: { min: 1, max: 1 }, videos: { max: 0 } },
  params: [
    {
      id: 'falSeedvr2UpscaleFactor',
      type: 'dropdown',
      valueType: 'number',
      order: 1,
      transferKey: 'upscaleFactor',
      default: 2,
      options: FAL_SEEDVR2_UPSCALE_FACTORS.map((value) => ({ value })),
    },
    {
      id: 'falSeedvr2NoiseScale',
      type: 'number',
      order: 2,
      transferKey: 'noiseScale',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.1,
    },
  ],
  endpoints: { selector: async () => 'fal-ai/seedvr/upscale/image' },
  request: {
    builder: (params) => ({
      image_url: requireSingleUpscaleImage(params, 'SeedVR2 图片放大'),
      upscale_mode: 'factor',
      upscale_factor: FAL_SEEDVR2_UPSCALE_FACTORS.includes(Number(params.falSeedvr2UpscaleFactor) as 2 | 4)
        ? Number(params.falSeedvr2UpscaleFactor)
        : 2,
      noise_scale: clampNoiseScale(params.falSeedvr2NoiseScale),
    }),
  },
  pricing: {
    currency: '$',
    calculator: (params) => (readUpscaleOutputMegapixels(params) ?? 1) * 0.001,
    description: 'Fal 标价 $0.001/MP；应用按预计输出像素显示估价',
  },
})

export default falSeedvr2ImageUpscaleModel
