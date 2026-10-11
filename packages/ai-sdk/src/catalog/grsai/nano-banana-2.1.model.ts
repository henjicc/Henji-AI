import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import { NANO21_RATIOS, NANO21_RESOLUTIONS, nano21Choice, nano21Options, nano21Prompt, nano21Ratio } from '../shared/nanoBanana21'

export const grsaiNanoBanana21Model = defineModel({
  meta: {
    id: 'grsai-nano-banana-2.1', canonicalModelId: 'nano-banana-2.1', seriesId: 'nano-banana', seriesRank: 2.1,
    provider: 'grsai', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-grsai'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 },
  },
  inputLimits: { images: {}, videos: { max: 0 }, audios: { max: 0 } },
  params: [
    { id: 'grsaiNanoBanana21AspectRatio', type: 'dropdown', order: 1, default: 'smart', options: nano21Options(['smart', ...NANO21_RATIOS]) },
    { id: 'grsaiNanoBanana21Resolution', type: 'dropdown', order: 2, default: '1K', options: nano21Options(NANO21_RESOLUTIONS) },
  ],
  endpoints: '/v1/api/generate',
  request: { builder: params => {
    const body: JsonObject = { model: 'nano-banana-2.1', prompt: nano21Prompt(params),
      aspectRatio: nano21Ratio(params.grsaiNanoBanana21AspectRatio),
      imageSize: nano21Choice(params.grsaiNanoBanana21Resolution, NANO21_RESOLUTIONS, '1K') }
    const images = resolveUploadedImageSources(params)
    if (images.length) body.images = images
    return body
  } },
  pricing: { currency: '¥', calculator: () => 0.12,
    description: '1200积分/次；基础充值档 10000积分/元约 ¥0.12，高额充值档 20000积分/元低至 ¥0.06，各分辨率同价。' },
})
export default grsaiNanoBanana21Model
