/** APIMart Nano Banana 2 Lite EXT 图片生成与编辑模型（运行时契约） */

import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9'] as const

export const apimartNanoBanana2LiteModel = defineModel({
  meta: {
    id: 'apimart-nano-banana-2-lite',
    canonicalModelId: 'nano-banana-2-lite',
    seriesId: 'nano-banana',
    seriesRank: 2.1,
    provider: 'apimart',
    type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-14', 'multi-output', 'provider-apimart'],
    aliases: ['nano-banana-2-lite-apimart'],
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 35 }
  },
  inputLimits: { images: { max: 14 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartNanoBanana2LiteChannel', type: 'dropdown', order: 1,
      default: 'standard',
      options: [{ value: 'standard' }, { value: 'official' }]
    },
    {
      id: 'apimartNanoBanana2LiteAspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [{ value: 'smart' }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio }))]
    },
    {
      id: 'apimartNanoBanana2LiteCount', type: 'number', order: 3,
      default: 1, min: 1, max: 4, step: 1
    }
  ],
  endpoints: '/v1/images/generations',
  request: {
    builder: (params) => {
      const clean = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const ratios = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9']
      const rawRatio = String(params.apimartNanoBanana2LiteAspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio
        : 1
      let size = ratios.includes(rawRatio) ? rawRatio : '1:1'
      if (rawRatio === 'smart' || rawRatio === 'auto') {
        let bestDiff = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const difference = Math.abs(pair[0] / pair[1] - hint)
          if (difference < bestDiff) {
            bestDiff = difference
            size = candidate
          }
        }
      }
      const body: JsonObject = {
        model: params.apimartNanoBanana2LiteChannel === 'official'
          ? 'gemini-3.1-flash-lite-image'
          : 'gemini-3.1-flash-lite-image-ext',
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        size,
        n: Math.min(4, Math.max(1, Math.round(Number(params.apimartNanoBanana2LiteCount || 1))))
      }
      if (images.length > 0) body.image_urls = images.slice(0, 14)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(4, Math.max(1, Math.round(Number(params.apimartNanoBanana2LiteCount || 1))))
      * (params.apimartNanoBanana2LiteChannel === 'official' ? 0.032 : 0.0125),
    description: '常规渠道 1K $0.0125/张；官方渠道按 token 结算，估算 $0.032/张；两渠道均不提供无效的分辨率与搜索开关'
  }
})

export default apimartNanoBanana2LiteModel
