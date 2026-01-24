/**
 * Wan 2.5 Preview 视频生成模型
 *
 * 万象 2.5 预览版本，支持文生视频和图生视频
 */

import { defineModel } from '@/core'

export const wan25PreviewModel = defineModel({
  meta: {
    id: 'wan-2.5-preview',
    provider: 'ppio',
    type: 'video',
    name: 'Wan 2.5 Preview',
    description: '万象 2.5 预览版视频生成模型，支持文生视频和图生视频',
    tags: ['video', 'text-to-video', 'image-to-video'],
    progress: {
      mode: 'polling',
      baseAttempts: 28,
      perUnitAttempts: 2,
      scaleWith: 'ppioWan25VideoDuration',
      minDurationMs: 40000,
      maxDurationMs: 180000
    }
  },
  params: [
    // 1. 时长
    {
      id: 'ppioWan25VideoDuration',
      type: 'dropdown',
      order: 1,
      name: { zh: '时长', en: 'Duration' },
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },
    // 2. 尺寸（文生视频）
    {
      id: 'ppioWan25Size',
      type: 'dropdown',
      order: 2,
      name: { zh: '尺寸', en: 'Size' },
      default: '1280*720',
      options: [
        { value: '832*480', label: '832×480' },
        { value: '480*832', label: '480×832' },
        { value: '624*624', label: '624×624' },
        { value: '1280*720', label: '1280×720' },
        { value: '720*1280', label: '720×1280' },
        { value: '960*960', label: '960×960' },
        { value: '1088*832', label: '1088×832' },
        { value: '832*1088', label: '832×1088' },
        { value: '1920*1080', label: '1920×1080' },
        { value: '1080*1920', label: '1080×1920' },
        { value: '1440*1440', label: '1440×1440' },
        { value: '1632*1248', label: '1632×1248' },
        { value: '1248*1632', label: '1248×1632' }
      ],
      apiField: 'size'
    },
    // 3. 分辨率（图生视频）
    {
      id: 'ppioWan25Resolution',
      type: 'dropdown',
      order: 3,
      name: { zh: '分辨率', en: 'Resolution' },
      default: '720P',
      options: [
        { value: '480P', label: '480P' },
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 4. 智能改写
    {
      id: 'ppioWan25PromptExtend',
      type: 'switch',
      order: 4,
      name: { zh: '智能改写', en: 'Prompt Extend' },
      default: true,
      apiField: 'prompt_extend'
    },
    // 5. 生成音频
    {
      id: 'ppioWan25Audio',
      type: 'switch',
      order: 5,
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: true,
      apiField: 'audio'
    },
    // 6. 负面提示词
    {
      id: 'ppioWan25NegativePrompt',
      type: 'textarea',
      order: 6,
      name: { zh: '负面提示词', en: 'Negative Prompt' },
      default: '',
      apiField: 'negative_prompt'
    }
  ],
  linkages: [
    // Hide size parameter when image is uploaded (use resolution instead)
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioWan25Size'],
      condition: (images) => (images?.length || 0) > 0
    },
    // Hide resolution parameter when no image (use size instead)
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioWan25Resolution'],
      condition: (images) => (images?.length || 0) === 0
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = params.images || []
      return images.length > 0 ? '/async/wan-2.5-i2v-preview' : '/async/wan-2.5-t2v-preview'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const duration = params.ppioWan25VideoDuration || params.duration || 5
      const prompt_extend = params.ppioWan25PromptExtend !== undefined ? params.ppioWan25PromptExtend : (params.prompt_extend === undefined ? true : params.prompt_extend)
      const audio = params.ppioWan25Audio !== undefined ? params.ppioWan25Audio : (params.audio === undefined ? true : params.audio)
      const prompt = params.prompt || ''
      const negativePrompt = params.ppioWan25NegativePrompt || params.negative_prompt || ''
      const audioUrl = params.audio_url

      if (images.length > 0) {
        // Image-to-video
        return {
          input: {
            prompt,
            negative_prompt: negativePrompt,
            img_url: images[0],
            ...(audioUrl ? { audio_url: audioUrl } : {})
          },
          parameters: {
            resolution: params.ppioWan25Resolution || params.resolution || '1080P',
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
      } else {
        // Text-to-video
        return {
          input: {
            prompt,
            negative_prompt: negativePrompt,
            ...(audioUrl ? { audio_url: audioUrl } : {})
          },
          parameters: {
            size: params.ppioWan25Size || params.size || '1920*1080',
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.ppioWan25VideoDuration || 5
      const basePrice = 0.3
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 ¥0.3/5秒'
  }
})

export default wan25PreviewModel;
