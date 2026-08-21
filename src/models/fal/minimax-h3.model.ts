/** Fal MiniMax H3 多模态视频模型 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const falMiniMaxH3Model = defineModel({
  meta: {
    id: 'fal-ai-minimax-h3', canonicalModelId: 'minimax-h3', seriesId: 'minimax-hailuo', seriesRank: 3,
    provider: 'fal', type: 'video', i18nScope: 'models.defs.fal-ai-minimax-h3',
    name: { key: 'meta.name', fallback: 'MiniMax H3' },
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'mixed-upload-mode', 'multi-mode-switch', 'supports-4k', 'provider-fal'],
    aliases: ['minimax-h3-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'falMiniMaxH3Mode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
  },
  params: [
    {
      id: 'falMiniMaxH3Mode', type: 'dropdown', order: 1,
      name: sharedFieldText('mode'), default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falMiniMaxH3AspectRatio', type: 'dropdown', order: 2,
      name: sharedFieldText('aspectRatio'), default: 'smart',
      options: [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' }, { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' }, { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' }, { value: '9:16', label: '9:16' }
      ]
    },
    {
      id: 'falMiniMaxH3Resolution', type: 'dropdown', order: 3,
      name: sharedFieldText('resolution'), default: '2K',
      options: ['480P', '768P', '2K', '4K'].map((value) => ({ value, label: value }))
    },
    {
      id: 'falMiniMaxH3Duration', type: 'number', order: 4,
      name: sharedFieldText('duration'), default: 5, min: 5, max: 15, step: 1
    },
    {
      id: 'falMiniMaxH3PromptExpansion', type: 'switch', order: 5,
      name: sharedFieldText('promptExpansion'), default: true
    },
    {
      id: 'falMiniMaxH3PromptExpansionMode', type: 'dropdown', order: 6,
      name: { zh: '提示词扩写模式', en: 'Prompt Expansion Mode' }, default: 'balanced',
      options: [
        { value: 'balanced', label: { zh: '平衡', en: 'Balanced' } },
        { value: 'fast', label: { zh: '快速', en: 'Fast' } },
        { value: 'quality', label: { zh: '高质量', en: 'Quality' } }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : []
      const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : [])
      if (params.falMiniMaxH3Mode === 'reference-to-video') return 'minimax/h3/reference-to-video'
      return images.length > 0 ? 'minimax/h3/image-to-video' : 'minimax/h3/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
      const pick = (primary: DynamicValue, fallback: DynamicValue): string[] => {
        const first = clean(primary)
        return first.length > 0 ? first : clean(fallback)
      }
      const images = pick(params.uploadedFilePaths, params.images)
      const videos = pick(params.uploadedVideoFilePaths, params.videos)
      const audios = pick(params.uploadedAudioFilePaths, params.audios)
      const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
      const raw = String(params.falMiniMaxH3AspectRatio || 'smart')
      const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9
      let ratio = ratios.includes(raw) ? raw : '16:9'
      if (raw === 'smart' || raw === 'auto') {
        let difference = Number.POSITIVE_INFINITY
        for (const candidate of ratios) {
          const pair = candidate.split(':').map(Number)
          const next = Math.abs(pair[0] / pair[1] - hint)
          if (next < difference) { difference = next; ratio = candidate }
        }
      }
      const resolution = ['480P', '768P', '4K'].includes(String(params.falMiniMaxH3Resolution)) ? String(params.falMiniMaxH3Resolution) : '2K'
      const body: DynamicValueMap = {
        prompt: typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 7000) : '',
        duration: Math.min(15, Math.max(5, Math.round(Number(params.falMiniMaxH3Duration || 5)))),
        resolution,
        enable_prompt_expansion: params.falMiniMaxH3PromptExpansion !== false,
        prompt_expansion_mode: ['fast', 'quality'].includes(String(params.falMiniMaxH3PromptExpansionMode))
          ? String(params.falMiniMaxH3PromptExpansionMode)
          : 'balanced',
        enable_safety_checker: true
      }
      if (!body.prompt) throw new Error('MiniMax H3 的提示词不能为空')
      if (params.falMiniMaxH3Mode === 'reference-to-video') {
        if (images.length + videos.length + audios.length > 12) {
          throw new Error('Fal MiniMax H3 的参考素材总数不能超过 12 个')
        }
        if (audios.length > 0 && images.length + videos.length === 0) {
          throw new Error('Fal MiniMax H3 的参考音频必须与参考图片或参考视频一起使用')
        }
        body.aspect_ratio = raw === 'smart' && (images.length + videos.length) > 0 ? 'adaptive' : ratio
        if (images.length > 0) body.reference_image_urls = images.slice(0, 9)
        if (videos.length > 0) body.reference_video_urls = videos.slice(0, 3)
        if (audios.length > 0) body.reference_audio_urls = audios.slice(0, 3)
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
      const duration = Math.min(15, Math.max(5, Math.round(Number(params.falMiniMaxH3Duration || 5))))
      const rates: Record<string, number> = { '480P': 0.05, '768P': 0.06, '2K': 0.13, '4K': 0.16 }
      const images = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths.length : (Array.isArray(params.images) ? params.images.length : 0)
      const referenceExtra = params.falMiniMaxH3Mode === 'reference-to-video' ? Math.max(0, images - 5) * 0.08 : 0
      return duration * (rates[String(params.falMiniMaxH3Resolution || '2K')] ?? rates['2K']) + referenceExtra
    },
    description: '480P/768P/2K/4K 为 $0.05/$0.06/$0.13/$0.16 每秒；参考模式第 6 张起图片 +$0.08/张'
  }
})

export default falMiniMaxH3Model
