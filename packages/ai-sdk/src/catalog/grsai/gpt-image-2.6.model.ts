import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { GPT25_RATIOS, gpt25Options, gpt25Ratio } from '../shared/gptImage25'
import { resolveUploadedImageSources } from '../shared/mediaPresence'

// 标准渠道只有 1K，比例格式与 GPT Image 2 同表（不含 1:3、3:1）。
const ratios = GPT25_RATIOS.filter(r => r !== '1:3' && r !== '3:1')

export const grsaiGptImage26Model = defineModel({
  meta: {
    id: 'grsai-gpt-image-2.6', canonicalModelId: 'gpt-image-2.6', seriesId: 'gpt-image', seriesRank: 2.6,
    provider: 'grsai', type: 'image',
    tags: ['text-to-image', 'image-to-image'],
    polling: { interval: 3000, maxAttempts: 200 },
  },
  // Grsai官方未声明参考图数量上限，不附加本地产品上限。
  inputLimits: { images: {}, videos: { max: 0 } },
  params: [
    { id: 'grsaiGpt26AspectRatio', type: 'dropdown', order: 1, default: 'smart', options: gpt25Options(['smart', ...ratios]) },
  ],
  endpoints: '/v1/api/generate',
  request: { builder: params => {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 GPT Image 2.6 提示词')
    const body: JsonObject = {
      model: 'gpt-image-2.6', prompt: params.prompt,
      aspectRatio: gpt25Ratio(params, params.grsaiGpt26AspectRatio, ratios),
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
export default grsaiGptImage26Model
