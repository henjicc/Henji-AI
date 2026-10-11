import { defineModel } from '../defineModel'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import { NANO21_RATIOS, NANO21_RESOLUTIONS, nano21Choice, nano21Options, nano21Prompt, nano21Ratio } from '../shared/nanoBanana21'

export const kieNanoBanana21Model = defineModel({
  meta: {
    id: 'kie-nano-banana-2.1', canonicalModelId: 'nano-banana-2.1', seriesId: 'nano-banana', seriesRank: 2.1,
    provider: 'kie', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-kie'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 },
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [
    { id: 'kieNanoBanana21AspectRatio', type: 'dropdown', order: 1, default: 'smart', options: nano21Options(['smart', ...NANO21_RATIOS]) },
    { id: 'kieNanoBanana21Resolution', type: 'dropdown', order: 2, default: '1K', options: nano21Options(NANO21_RESOLUTIONS) },
    { id: 'kieNanoBanana21OutputFormat', type: 'dropdown', order: 3, default: 'jpg', options: nano21Options(['jpg', 'png']) },
  ],
  endpoints: '/api/v1/jobs/createTask',
  request: { builder: params => {
    const images = resolveUploadedImageSources(params)
    if (images.length > 10) throw new Error('Nano Banana 2.1 KIE 最多支持 10 张参考图')
    return { model: 'nano-banana-2-1', input: {
      prompt: nano21Prompt(params, 20000), image_input: images,
      aspect_ratio: nano21Ratio(params.kieNanoBanana21AspectRatio),
      resolution: nano21Choice(params.kieNanoBanana21Resolution, NANO21_RESOLUTIONS, '1K'),
      output_format: nano21Choice(params.kieNanoBanana21OutputFormat, ['jpg', 'png'], 'jpg'),
    } }
  } },
  pricing: {
    currency: '$', calculator: params => ({ '1K': 0.02, '2K': 0.03, '4K': 0.045 }[String(params.kieNanoBanana21Resolution ?? '1K')] ?? 0.02),
    description: '1K $0.02/张、2K $0.03/张、4K $0.045/张（4/6/9 credits，$0.005/credit）',
  },
})
export default kieNanoBanana21Model
