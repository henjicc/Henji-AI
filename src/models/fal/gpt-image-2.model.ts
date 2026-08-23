/** Fal GPT Image 2 图片生成与编辑模型 */

import { defineModel, sharedFieldText, sharedOptionText } from '@/core'

export const falGptImage2Model = defineModel({
  meta: {
    id: 'fal-ai-gpt-image-2', canonicalModelId: 'gpt-image-2', seriesId: 'gpt-image', seriesRank: 2,
    provider: 'fal', type: 'image', i18nScope: 'models.defs.fal-ai-gpt-image-2',
    name: { key: 'meta.name', fallback: 'GPT Image 2' },
    tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-fal'],
    aliases: ['gpt-image-2-fal'], polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 45 }
  },
  inputLimits: { images: { max: 16 }, videos: { max: 0 } },
  params: [
    {
      id: 'falGptImage2AspectRatio', type: 'dropdown', order: 1,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'falGptImage2Resolution', type: 'dropdown', order: 2,
      name: sharedFieldText('resolution'), default: 'high',
      options: [
        { value: 'low', label: { zh: '低质量', en: 'Low' } },
        { value: 'medium', label: { zh: '标准', en: 'Medium' } },
        { value: 'high', label: { zh: '高质量', en: 'High' } }
      ]
    },
    {
      id: 'falGptImage2NumImages', type: 'number', order: 3,
      name: sharedFieldText('numberOfImages'), default: 1, min: 1, max: 4, step: 1
    },
    {
      id: 'falGptImage2MaskUrl', type: 'image-upload', order: 4,
      name: { zh: '局部重绘遮罩', en: 'Inpainting Mask' }, default: [],
      valueType: 'array', maxCount: 1, format: 'url',
      accept: ['image/png', 'image/webp'], maxSize: 20 * 1024 * 1024,
      description: { zh: '请上传带透明通道的遮罩图', en: 'Upload a mask image with alpha' },
      visible: {
        condition: (params) => {
          const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
          const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
          return images.length > 0
        }
      }
    }
  ],
  linkages: [],
  runtimeConstraints: { mediaFields: [{ field: 'mask_url', kind: 'image' }] },
  endpoints: {
    selector: async (params) => {
      const primary = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const fallback = Array.isArray(params.images) ? params.images : []
      const images = primary.length > 0 ? primary : fallback
      return images.length > 0 ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2'
    }
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const primary = clean(params.uploadedFilePaths)
      const images = primary.length > 0 ? primary : clean(params.images)
      const rawRatio = String(params.falGptImage2AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio : 1
      const candidates: Array<[string, number]> = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16]]
      let ratio = candidates.some(([value]) => value === rawRatio) ? rawRatio : '1:1'
      if (rawRatio === 'smart' || rawRatio === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const [value, numeric] of candidates) {
          const next = Math.abs(numeric - hint)
          if (next < difference) { difference = next; ratio = value }
        }
      }
      const sizeMap: Record<string, string> = {
        '1:1': 'square_hd', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3',
        '16:9': 'landscape_16_9', '9:16': 'portrait_16_9'
      }
      const quality = ['low', 'medium'].includes(String(params.falGptImage2Resolution))
        ? String(params.falGptImage2Resolution) : 'high'
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 32000) : '',
        image_size: images.length > 0 && rawRatio === 'smart' ? 'auto' : sizeMap[ratio],
        quality,
        num_images: Math.min(4, Math.max(1, Math.round(Number(params.falGptImage2NumImages || 1))))
      }
      if (images.length > 0) body.image_urls = images.slice(0, 16)
      const maskCandidates = Array.isArray(params.falGptImage2MaskUrl)
        ? params.falGptImage2MaskUrl
        : [params.falGptImage2MaskUrl]
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
      const quality = String(params.falGptImage2Resolution || 'high')
      const squareReference: Record<string, number> = { low: 0.006, medium: 0.053, high: 0.211 }
      const count = Math.min(4, Math.max(1, Math.round(Number(params.falGptImage2NumImages || 1))))
      return count * (squareReference[quality] ?? squareReference.high)
    },
    description: '按文本/图片 token 计费；估算采用官方 1024×1024 示例：低 $0.006、标准 $0.053、高质量 $0.211/张'
  }
})

export default falGptImage2Model
