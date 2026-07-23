/**
 * Veo 3.1 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const veo31Model = defineModel({
  meta: {
    id: 'fal-ai-veo-3.1',
    canonicalModelId: 'veo-3.1',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-veo-3.1',
    name: { key: 'meta.name', fallback: 'Veo 3.1' },
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 7 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falVeo31Mode === "start-end-frame"',
        images: { exact: 2 }
      },
      {
        when: 'falVeo31Mode === "reference-to-video"',
        images: { max: 7 }
      }
    ]
  },
  requirements: [
    {
      id: 'veo-31-start-end-frame',
      when: 'falVeo31Mode === "start-end-frame"',
      require: { images: { exact: 2 } },
      message: {
        title: '图片必需',
        message: '首尾帧模式需要上传2张图片',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'falVeo31Mode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'text-image-to-video',
      options: [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'start-end-frame', label: sharedModeText('startEndFrame', 'Start/End Frame') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
    },
    {
      id: 'falVeo31VideoDuration',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 8,
      options: [
        { value: 4, label: '4s' },
        { value: 6, label: '6s' },
        { value: 8, label: '8s' }
      ]
    },
    {
      id: 'falVeo31AspectRatio',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('aspectRatio'),
      default: '16:9',
      visible: {
        condition: 'falVeo31Mode !== "reference-to-video"'
      },
      options: [
        { value: 'auto', label: sharedOptionText('auto') },
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' }
      ]
    },
    {
      id: 'falVeo31Resolution',
      order: 4,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '720p',
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' }
      ]
    },
    {
      id: 'falVeo31GenerateAudio',
      order: 5,
      type: 'switch',
      name: sharedFieldText('generateAudio'),
      default: false
    },
    {
      id: 'falVeo31AutoFix',
      order: 6,
      type: 'switch',
      name: sharedFieldText('autoFix'),
      default: false
    },
    {
      id: 'falVeo31FastMode',
      order: 7,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: false
    },
    {
      id: 'falVeo31EnhancePrompt',
      order: 8,
      type: 'switch',
      name: sharedFieldText('enhancePrompt'),
      default: false
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.falVeo31Mode || 'text-image-to-video'
      const images = params.images || []
      const fastMode = params.falVeo31FastMode === true

      if (mode === 'start-end-frame') {
        return fastMode
          ? 'fal-ai/veo3.1/fast/first-last-frame-to-video'
          : 'fal-ai/veo3.1/first-last-frame-to-video'
      }

      if (mode === 'reference-to-video') {
        return 'fal-ai/veo3.1/reference-to-video'
      }

      if (images.length > 0) {
        return fastMode ? 'fal-ai/veo3.1/fast/image-to-video' : 'fal-ai/veo3.1/image-to-video'
      }

      return fastMode ? 'fal-ai/veo3.1/fast' : 'fal-ai/veo3.1'
    }
  },
  request: {
    builder: (params) => {
      const images = params.images || []
      const prompt = params.prompt || ''
      const mode = params.falVeo31Mode || 'text-image-to-video'
      const duration = params.falVeo31VideoDuration || 8
      const aspectRatio = params.falVeo31AspectRatio
      const resolution = params.falVeo31Resolution || '720p'
      const enhancePrompt = params.falVeo31EnhancePrompt
      const generateAudio = params.falVeo31GenerateAudio
      const autoFix = params.falVeo31AutoFix

      const requestData: DynamicValue = {
        prompt,
        duration: `${duration}s`
      }

      if (aspectRatio && aspectRatio !== 'auto' && aspectRatio !== 'smart' && mode !== 'reference-to-video') {
        requestData.aspect_ratio = aspectRatio
      }

      if (resolution) {
        requestData.resolution = resolution
      }

      if (enhancePrompt !== undefined) {
        requestData.enhance_prompt = enhancePrompt
      }

      if (generateAudio !== undefined) {
        requestData.generate_audio = generateAudio
      }

      if (autoFix !== undefined) {
        requestData.auto_fix = autoFix
      }

      if (images.length > 0) {
        if (mode === 'start-end-frame') {
          requestData.first_frame_url = images[0]
          requestData.last_frame_url = images[1]
        } else if (mode === 'reference-to-video') {
          requestData.image_urls = images
        } else {
          requestData.image_url = images[0]
        }
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.15,
    description: '基础价格 $0.15/次'
  }
})

export default veo31Model;
