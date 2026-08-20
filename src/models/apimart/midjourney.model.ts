/** APIMart Midjourney Imagine 图片生成模型 */

import { defineModel } from '@/core'

export const apimartMidjourneyModel = defineModel({
  meta: {
    id: 'apimart-midjourney', canonicalModelId: 'midjourney', seriesId: 'midjourney', seriesRank: 1,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-midjourney',
    name: { key: 'meta.name', fallback: 'Midjourney' },
    tags: ['text-to-image', 'provider-apimart'], aliases: ['midjourney-apimart'],
    polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 } },
  params: [], linkages: [], endpoints: '/v1/midjourney/generations',
  request: {
    builder: (params) => ({
      model: 'midjourney',
      prompt: typeof params.prompt === 'string' ? params.prompt : ''
    })
  },
  pricing: { currency: '$', fixed: 0.04504, description: '标准 Imagine $0.04504/次；后续动作另行计费' }
})

export default apimartMidjourneyModel
