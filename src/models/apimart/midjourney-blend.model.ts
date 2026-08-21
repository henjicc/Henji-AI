/** APIMart Midjourney Blend 多图融合 */

import { defineModel, sharedFieldText } from '@/core'

export const apimartMidjourneyBlendModel = defineModel({
  meta: {
    id: 'apimart-midjourney-blend', canonicalModelId: 'midjourney', seriesId: 'midjourney', seriesRank: 1.1,
    provider: 'apimart', type: 'image', i18nScope: 'models.defs.apimart-midjourney-blend',
    name: { key: 'meta.name', fallback: 'Midjourney Blend' },
    tags: ['image-to-image', 'supports-multi-image', 'provider-apimart'],
    aliases: ['midjourney-blend-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  inputLimits: { images: { min: 2, max: 4 }, videos: { max: 0 }, audios: { max: 0 } },
  requirements: [{
    id: 'apimart-midjourney-blend-images',
    require: { images: { min: 2, max: 4 } },
    message: { title: '需要多张图片', message: 'Midjourney Blend 需要 2–4 张图片。', type: 'warning' }
  }],
  params: [
    {
      id: 'apimartMidjourneyBlendAspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: '1:1',
      options: ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartMidjourneyBlendSpeed', type: 'dropdown', order: 2,
      name: { zh: '生成速度', en: 'Generation Speed' }, default: 'relax',
      options: [
        { value: 'relax', label: { zh: '休闲', en: 'Relax' } },
        { value: 'fast', label: { zh: '快速', en: 'Fast' } },
        { value: 'turbo', label: { zh: '极速', en: 'Turbo' } }
      ]
    }
  ],
  linkages: [],
  endpoints: '/v1/midjourney/generations/blend',
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      if (images.length < 2 || images.length > 4) throw new Error('Midjourney Blend 只支持 2–4 张图片')
      const ratio = String(params.apimartMidjourneyBlendAspectRatio || '1:1')
      return {
        image_urls: images,
        size: /^\d+:\d+$/u.test(ratio) ? ratio : '1:1',
        speed: params.apimartMidjourneyBlendSpeed === 'fast' || params.apimartMidjourneyBlendSpeed === 'turbo'
          ? params.apimartMidjourneyBlendSpeed
          : 'relax'
      }
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => params.apimartMidjourneyBlendSpeed === 'turbo' ? 0.1 : 0.05504,
    description: 'Blend Relax/Fast $0.05504 每次，Turbo $0.1 每次'
  }
})

export default apimartMidjourneyBlendModel
