/** APIMart Grok Imagine Image 2.0 EXT 与官方渠道统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { countUploadedImages, hasUploadedImage } from '../shared/mediaPresence'
import type { JsonValue } from '../../types/runtime'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const EXT_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const
const OFFICIAL_ASPECT_RATIOS = [
  '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
  '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1'
] as const
const ALL_ASPECT_RATIOS = [...new Set([...EXT_ASPECT_RATIOS, ...OFFICIAL_ASPECT_RATIOS])]

export const apimartGrokImagine20Model = defineModel({
  meta: {
    id: 'apimart-grok-imagine-2.0',
    canonicalModelId: 'grok-imagine-image-2.0',
    seriesId: 'grok-imagine-image',
    seriesRank: 2,
    provider: 'apimart',
    type: 'image',
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-3', 'multi-output', 'supports-2k', 'provider-apimart'],
    aliases: ['grok-imagine-2-apimart', 'apimart-grok-imagine-2.0-official', 'grok-imagine-image-2-official-apimart'],
    aliasParamDefaults: {
      'apimart-grok-imagine-2.0-official': { apimartGrokImagine20Version: 'official' },
      'grok-imagine-image-2-official-apimart': { apimartGrokImagine20Version: 'official' }
    },
    polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 },
    rules: [
      { when: 'apimartGrokImagine20Version === "official"', images: { max: 3 } }
    ]
  },
  params: [
    {
      id: 'apimartGrokImagine20Version', type: 'dropdown', order: 1,
      default: 'ext',
      options: [
        { value: 'ext' },
        { value: 'official' }
      ]
    },
    {
      id: 'apimartGrokImagine20AspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [
        { value: 'smart' },
        ...ALL_ASPECT_RATIOS.map((ratio) => ({ value: ratio }))
      ]
    },
    {
      id: 'apimartGrokImagine20Resolution', type: 'dropdown', order: 3,
      default: '1K',
      visible: { condition: (params) => params.apimartGrokImagine20Version === 'official' },
      options: ['1K', '2K'].map((value) => ({ value }))
    },
    {
      id: 'apimartGrokImagine20Quality', type: 'dropdown', order: 4,
      default: 'medium',
      visible: {
        condition: (params) => params.apimartGrokImagine20Version === 'official' && !hasUploadedImage(params)
      },
      options: [
        { value: 'low' },
        { value: 'medium' }
      ]
    },
    {
      id: 'apimartGrokImagine20Count', type: 'number', order: 5,
      default: 1, min: 1, max: 12, step: 1
    }
  ],
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const clean = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const isOfficial = params.apimartGrokImagine20Version === 'official'
      const supported = isOfficial
        ? ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1']
        : ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']
      const raw = String(params.apimartGrokImagine20AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio : 1
      let ratio = supported.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of supported) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; ratio = candidate }
        }
      }
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 8000) : ''

      if (!isOfficial) {
        if (images.length > 0) throw new Error('Grok Imagine Image 2.0 EXT 不支持参考图，请切换为官方渠道')
        return {
          model: 'grok-imagine-2.0-ext',
          prompt,
          n: Math.min(12, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1)))),
          size: ratio,
          nsfw_check: false
        }
      }

      const body: Record<string, JsonValue> = {
        model: 'grok-imagine-image-2.0',
        prompt,
        n: Math.min(10, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1)))),
        aspect_ratio: ratio,
        resolution: params.apimartGrokImagine20Resolution === '2K' ? '2k' : '1k',
        nsfw_check: false
      }
      if (images.length === 0) {
        body.quality = params.apimartGrokImagine20Quality === 'low' ? 'low' : 'medium'
      } else {
        body.image_urls = images.slice(0, 3)
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const count = params.apimartGrokImagine20Version === 'official'
        ? Math.min(10, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1))))
        : Math.min(12, Math.max(1, Math.round(Number(params.apimartGrokImagine20Count || 1))))
      if (params.apimartGrokImagine20Version !== 'official') return count * 0.015

      const resolution = params.apimartGrokImagine20Resolution === '2K' ? '2K' : '1K'
      const quality = params.apimartGrokImagine20Quality === 'low' ? 'low' : 'medium'
      const prices: Record<string, number> = { '1K-low': 0.032, '1K-medium': 0.048, '2K-low': 0.048, '2K-medium': 0.064 }
      return count * (prices[`${resolution}-${quality}`] ?? 0.048) + Math.min(3, countUploadedImages(params)) * 0.008
    },
    description: 'EXT：$0.015/张；官方渠道：1K $0.032/$0.048、2K $0.048/$0.064（低/标准），参考图 $0.008/张'
  }
})

export default apimartGrokImagine20Model
