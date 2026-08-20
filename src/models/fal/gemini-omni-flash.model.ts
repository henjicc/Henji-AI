/** Fal Gemini Omni Flash 图像参考视频模型 */

import { defineModel, sharedFieldText, sharedModeText } from '@/core'

export const falGeminiOmniFlashModel = defineModel({
  meta: {
    id: 'fal-ai-gemini-omni-flash', canonicalModelId: 'gemini-omni-video', seriesId: 'gemini-omni', seriesRank: 1,
    provider: 'fal', type: 'video', i18nScope: 'models.defs.fal-ai-gemini-omni-flash',
    name: { key: 'meta.name', fallback: 'Gemini Omni Flash' },
    tags: ['image-to-video', 'reference-mode', 'supports-multi-image', 'multi-mode-switch', 'provider-fal'],
    aliases: ['gemini-omni-flash-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
  },
  inputLimits: {
    images: { exact: 1 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'falGeminiOmniFlashMode === "reference-to-video"', images: { min: 1, max: 10 } }]
  },
  requirements: [
    {
      id: 'fal-gemini-omni-image', require: { images: { min: 1 } },
      message: { title: '图片必需', message: 'Gemini Omni Flash 需要至少 1 张图片作为视频输入。', type: 'warning' }
    }
  ],
  params: [
    {
      id: 'falGeminiOmniFlashMode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'image-to-video',
      options: [
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falGeminiOmniFlashAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: '16:9',
      options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
    },
    {
      id: 'falGeminiOmniFlashResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '720p',
      options: [{ value: '720p', label: '720p' }]
    },
    {
      id: 'falGeminiOmniFlashDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 8, min: 3, max: 10, step: 1
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => params.falGeminiOmniFlashMode === 'reference-to-video'
      ? 'google/gemini-omni-flash/reference-to-video' : 'google/gemini-omni-flash/image-to-video'
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        aspect_ratio: params.falGeminiOmniFlashAspectRatio === '9:16' ? '9:16' : '16:9',
        duration: Math.min(10, Math.max(3, Math.round(Number(params.falGeminiOmniFlashDuration || 8))))
      }
      if (params.falGeminiOmniFlashMode === 'reference-to-video') body.image_urls = images.slice(0, 10)
      else body.image_url = images[0]
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => Math.min(10, Math.max(3, Math.round(Number(params.falGeminiOmniFlashDuration || 8)))) * 0.13,
    description: '按 token 计费；720p 约 $0.13/秒'
  }
})

export default falGeminiOmniFlashModel
