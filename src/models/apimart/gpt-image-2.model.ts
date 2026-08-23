/** APIMart GPT Image 2 EXT 与官方渠道统一模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'
import { hasUploadedImage } from '@/models/shared/mediaPresence'

const APIMART_IMAGE_ENDPOINT = '/v1/images/generations'
const ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16',
  '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'
] as const

export const apimartGptImage2Model = defineModel({
  meta: {
    id: 'apimart-gpt-image-2',
    canonicalModelId: 'gpt-image-2',
    seriesId: 'gpt-image',
    seriesRank: 2,
    provider: 'apimart',
    type: 'image',
    i18nScope: 'models.defs.apimart-gpt-image-2',
    name: { key: 'meta.name', fallback: 'GPT Image 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'max-images-16', 'multi-output', 'supports-4k', 'provider-apimart'],
    aliases: ['gpt-image-2-apimart', 'apimart-gpt-image-2-official', 'gpt-image-2-official-apimart'],
    polling: { interval: 3000, maxAttempts: 240, expectedAttempts: 50 }
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    {
      id: 'apimartGptImage2Version', type: 'dropdown', order: 1,
      name: sharedFieldText('version'), default: 'ext',
      options: [
        { value: 'ext', label: { zh: '普通', en: 'Standard' } },
        { value: 'official', label: { zh: '官方', en: 'Official' } }
      ]
    },
    {
      id: 'apimartGptImage2AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        ...ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
      ]
    },
    {
      id: 'apimartGptImage2Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '1K',
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'apimartGptImage2Quality', type: 'dropdown', order: 4,
      name: sharedFieldText('quality'), default: 'auto',
      visible: { condition: (params) => params.apimartGptImage2Version === 'official' },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'low', label: { zh: '低', en: 'Low' } },
        { value: 'medium', label: { zh: '标准', en: 'Medium' } },
        { value: 'high', label: { zh: '高', en: 'High' } }
      ]
    },
    {
      id: 'apimartGptImage2Background', type: 'dropdown', order: 5,
      name: { zh: '背景', en: 'Background' }, default: 'auto',
      visible: { condition: (params) => params.apimartGptImage2Version === 'official' },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'opaque', label: { zh: '不透明', en: 'Opaque' } },
        { value: 'transparent', label: { zh: '透明', en: 'Transparent' } }
      ]
    },
    {
      id: 'apimartGptImage2Count', type: 'number', order: 6,
      name: { zh: '生成数量', en: 'Output Count' }, default: 1, min: 1, max: 4, step: 1,
      visible: { condition: (params) => params.apimartGptImage2Version === 'official' }
    },
    {
      id: 'apimartGptImage2MaskUrl', type: 'image-upload', order: 7,
      name: { zh: '局部重绘遮罩', en: 'Inpainting Mask' }, default: [],
      valueType: 'array', maxCount: 1, format: 'url',
      accept: ['image/png', 'image/webp'], maxSize: 20 * 1024 * 1024,
      description: { zh: '请上传与首张参考图同尺寸、带透明通道的遮罩图', en: 'Upload a mask with alpha matching the first reference image size' },
      visible: {
        condition: (params) => params.apimartGptImage2Version === 'official' && hasUploadedImage(params)
      }
    }
  ],
  linkages: [],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: APIMART_IMAGE_ENDPOINT,
  request: {
    builder: (params) => {
      const filterSources = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = filterSources(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : filterSources(params.images)
      const supported = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']
      const raw = String(params.apimartGptImage2AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio : 1
      let size = supported.includes(raw) ? raw : '1:1'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of supported) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; size = candidate }
        }
      }
      const resolution = ['2K', '4K'].includes(String(params.apimartGptImage2Resolution))
        ? String(params.apimartGptImage2Resolution).toLowerCase() : '1k'
      const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : ''
      const isOfficial = params.apimartGptImage2Version === 'official'

      if (!isOfficial) {
        const body: DynamicValueMap = {
          model: 'gpt-image-2', prompt, n: 1, size, resolution, nsfw_check: false
        }
        if (images.length > 0) body.image_urls = images.slice(0, 16)
        return body
      }

      const quality = ['low', 'medium', 'high'].includes(String(params.apimartGptImage2Quality))
        ? String(params.apimartGptImage2Quality)
        : 'auto'
      const background = ['opaque', 'transparent'].includes(String(params.apimartGptImage2Background))
        ? String(params.apimartGptImage2Background)
        : 'auto'
      const body: DynamicValueMap = {
        model: 'gpt-image-2-official',
        prompt,
        n: Math.min(4, Math.max(1, Math.round(Number(params.apimartGptImage2Count || 1)))),
        size,
        resolution,
        quality,
        background,
        nsfw_check: false
      }
      if (images.length > 0) body.image_urls = images.slice(0, 16)
      const maskCandidates = Array.isArray(params.apimartGptImage2MaskUrl)
        ? params.apimartGptImage2MaskUrl
        : [params.apimartGptImage2MaskUrl]
      const maskValue = maskCandidates.find((item) => typeof item === 'string' && item.trim().length > 0)
      const maskUrl = typeof maskValue === 'string' ? maskValue.trim() : ''
      if (maskUrl) {
        if (images.length === 0) throw new Error('GPT Image 2 局部重绘必须同时提供至少 1 张参考图')
        body.mask_url = maskUrl
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      if (params.apimartGptImage2Version !== 'official') {
        return params.apimartGptImage2Resolution === '4K'
          ? 0.021 : (params.apimartGptImage2Resolution === '2K' ? 0.014 : 0.0085)
      }
      const quality = String(params.apimartGptImage2Quality || 'auto')
      const oneK: Record<string, number> = { auto: 0.0048, low: 0.0048, medium: 0.0424, high: 0.1688 }
      const resolutionMultiplier = params.apimartGptImage2Resolution === '4K'
        ? 8
        : (params.apimartGptImage2Resolution === '2K' ? 4 : 1)
      const count = Math.min(4, Math.max(1, Math.round(Number(params.apimartGptImage2Count || 1))))
      return count * (oneK[quality] ?? oneK.auto) * resolutionMultiplier
    },
    description: 'EXT：1K $0.0085、2K $0.014、4K $0.021/张；官方渠道按 token 结算，显示值为不含输入 token 的估算'
  }
})

export default apimartGptImage2Model
