import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { GPT25_RATIOS, gpt25Choice, gpt25Options, gpt25Prompt, gpt25Ratio } from '../shared/gptImage25'
import { resolveUploadedImageSources } from '../shared/mediaPresence'

const regularRatios = GPT25_RATIOS.filter(r => r !== '1:3' && r !== '3:1')

export const grsaiGptImage25Model = defineModel({
  meta: {
    id: 'grsai-gpt-image-2.5', canonicalModelId: 'gpt-image-2.5', seriesId: 'gpt-image', seriesRank: 2.5,
    provider: 'grsai', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-grsai'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  // Grsai官方未声明参考图数量上限，不附加本地产品上限。
  inputLimits: { images: {}, videos: { max: 0 } },
  params: [
    { id: 'gpt25Variant', type: 'dropdown', order: 1, default: 'standard', options: gpt25Options(['standard']) },
    { id: 'gpt25AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: gpt25Options(['smart', ...regularRatios]) },
  ],
  endpoints: '/v1/api/generate',
  request: { builder: params => {
    gpt25Choice(params.gpt25Variant, ['standard'], 'standard')
    const body: JsonObject = {
      model: 'gpt-image-2.5', prompt: gpt25Prompt(params),
      aspectRatio: gpt25Ratio(params, params.gpt25AspectRatio, regularRatios),
    }
    const images = resolveUploadedImageSources(params)
    if (images.length) body.images = images
    return body
  } },
  pricing: {
    currency: '¥',
    calculator: () => 0.06,
    description: '标准渠道每次600积分；基础充值档¥0.06，高额充值档低至¥0.03',
  },
})
export default grsaiGptImage25Model
