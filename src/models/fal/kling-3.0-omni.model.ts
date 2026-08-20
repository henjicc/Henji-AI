/** Fal Kling O3（Kling 3.0 Omni）视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const falKling30OmniModel = defineModel({
  meta: {
    id: 'fal-ai-kling-3.0-omni', canonicalModelId: 'kling-video-3.0-omni', seriesId: 'kling-video', seriesRank: 3.02,
    provider: 'fal', type: 'video', i18nScope: 'models.defs.fal-ai-kling-3.0-omni',
    name: { key: 'meta.name', fallback: 'Kling 3.0 Omni' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'supports-multi-image', 'supports-audio-generation', 'multi-mode-switch', 'provider-fal'],
    aliases: ['kling-o3-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'falKling30OmniMode === "reference-to-video"', images: { max: 7 } }]
  },
  params: [
    {
      id: 'falKling30OmniMode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falKling30OmniAspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falKling30OmniResolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: 'standard',
      options: [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'pro', label: { zh: '专业', en: 'Pro' } }
      ]
    },
    {
      id: 'falKling30OmniDuration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 3, max: 15, step: 1
    },
    {
      id: 'falKling30OmniGenerateAudio', type: 'switch', order: 5,
      name: sharedFieldText('generateAudio'), default: false
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
      const tier = params.falKling30OmniResolution === 'pro' ? 'pro' : 'standard'
      const mode = params.falKling30OmniMode === 'reference-to-video'
        ? 'reference-to-video' : (images.length > 0 ? 'image-to-video' : 'text-to-video')
      return `fal-ai/kling-video/o3/${tier}/${mode}`
    }
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const raw = String(params.falKling30OmniAspectRatio || 'smart')
      const ratio = ['9:16', '1:1'].includes(raw) ? raw : '16:9'
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt : '',
        duration: String(Math.min(15, Math.max(3, Math.round(Number(params.falKling30OmniDuration || 5))))),
        generate_audio: params.falKling30OmniGenerateAudio === true,
        shot_type: 'customize'
      }
      if (params.falKling30OmniMode === 'reference-to-video') {
        body.aspect_ratio = ratio
        if (images.length > 0) body.image_urls = images.slice(0, 7)
      } else if (images.length > 0) {
        body.image_url = images[0]
        if (images.length > 1) body.end_image_url = images[1]
      } else {
        body.aspect_ratio = ratio
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const duration = Math.min(15, Math.max(3, Math.round(Number(params.falKling30OmniDuration || 5))))
      const audio = params.falKling30OmniGenerateAudio === true
      const pro = params.falKling30OmniResolution === 'pro'
      return duration * (pro ? (audio ? 0.14 : 0.112) : (audio ? 0.112 : 0.084))
    },
    description: '标准 $0.084/$0.112，专业 $0.112/$0.14 每秒（无/有音频）'
  }
})

export default falKling30OmniModel
