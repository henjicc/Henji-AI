import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import { NANO21_RATIOS, NANO21_RESOLUTIONS, nano21Choice, nano21Count, nano21Options, nano21Prompt, nano21Ratio } from '../shared/nanoBanana21'

export const apimartNanoBanana21Model = defineModel({
  meta: {
    id: 'apimart-nano-banana-2.1', canonicalModelId: 'nano-banana-2.1', seriesId: 'nano-banana', seriesRank: 3.1,
    provider: 'apimart', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 },
  },
  // 官方只声明单张 20MB；Ext 另外声明总计 50MB，未声明参考图数量上限。
  inputLimits: { images: {}, videos: { max: 0 }, audios: { max: 0 } },
  params: [
    { id: 'apimartNanoBanana21Channel', type: 'dropdown', order: 1, default: 'official', options: nano21Options(['official', 'ext']) },
    { id: 'apimartNanoBanana21AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: nano21Options(['smart', ...NANO21_RATIOS]) },
    { id: 'apimartNanoBanana21Resolution', type: 'dropdown', order: 3, default: '1K', options: nano21Options(NANO21_RESOLUTIONS) },
    { id: 'apimartNanoBanana21NumImages', type: 'number', order: 4, default: 1, min: 1, max: 4, step: 1, visible: { condition: p => p.apimartNanoBanana21Channel !== 'ext' } },
  ],
  endpoints: '/v1/images/generations',
  request: { builder: params => {
    const channel = nano21Choice(params.apimartNanoBanana21Channel, ['official', 'ext'], 'official')
    const resolution = nano21Choice(params.apimartNanoBanana21Resolution, NANO21_RESOLUTIONS, '1K')
    const size = nano21Ratio(params.apimartNanoBanana21AspectRatio)
    if (channel === 'ext' && resolution !== '1K' && ['1:4', '4:1', '1:8', '8:1'].includes(size)) {
      throw new Error('Nano Banana 2.1 Ext 的极端比例仅支持 1K')
    }
    const body: JsonObject = {
      model: channel === 'ext' ? 'gemini-nano-banana-2.1-ext' : 'gemini-nano-banana-2.1',
      prompt: nano21Prompt(params), size, resolution,
      n: nano21Count(params.apimartNanoBanana21NumImages, channel === 'ext' ? 1 : 4),
    }
    const images = resolveUploadedImageSources(params)
    if (images.length) body.image_urls = images
    // 不自动转入官方渠道：其 token 费用与 Ext 单张价格不同。
    if (channel === 'ext') body.official_fallback = false
    return body
  } },
  pricing: {
    currency: '$', calculator: params => {
      const ext = params.apimartNanoBanana21Channel === 'ext'
      const prices: Record<string, number> = ext ? { '1K': 0.02, '2K': 0.025, '4K': 0.03 } : { '1K': 0.02688, '2K': 0.04032, '4K': 0.09072 }
      return (prices[String(params.apimartNanoBanana21Resolution ?? '1K')] ?? prices['1K']) * nano21Count(params.apimartNanoBanana21NumImages, ext ? 1 : 4)
    },
    description: 'Ext 按张计费：1K $0.02、2K $0.025、4K $0.03。官方按实际 Token 结算；输出图像参考估算 $0.02688/$0.04032/$0.09072，输入与思考 Token 另计，非固定单张价。',
  },
})
export default apimartNanoBanana21Model
