/**
 * LTX 2 视频生成模型
 */

import { defineModel, sharedFieldText, sharedModeText, sharedOptionText } from '@/core'

export const ltx2Model = defineModel({
  meta: {
    id: 'fal-ai-ltx-2',
    provider: 'fal',
    type: 'video',
        i18nScope: 'models.defs.fal-ai-ltx-2',
    name: { key: 'meta.name', fallback: 'LTX 2' },
    description: 'LTX 2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  inputLimits: {
    images: { max: 0 },
    videos: { max: 0 },
    rules: [
      {
        when: 'falLtx2Mode === "image-to-video"',
        images: { max: 1 }
      },
      {
        when: 'falLtx2Mode === "retake-video"',
        images: { max: 0 },
        videos: { exact: 1 }
      }
    ]
  },
  requirements: [
    {
      id: 'ltx-2-retake-video',
      when: 'falLtx2Mode === "retake-video"',
      require: { videos: { exact: 1 } },
      message: {
        title: '视频必需',
        message: '视频编辑模式需要上传1个视频才能生成',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: 'falLtx2Mode',
      order: 1,
      type: 'dropdown',
      name: sharedFieldText('mode'),
      default: 'text-to-video',
      options: [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'retake-video', label: sharedModeText('retakeVideo') }
      ]
    },
    {
      id: 'falLtx2Resolution',
      order: 2,
      type: 'dropdown',
      name: sharedFieldText('resolution'),
      default: '1080p',
      visible: {
        condition: 'falLtx2Mode !== "retake-video"'
      },
      options: [
        { value: '1080p', label: '1080p' },
        { value: '1440p', label: '1440p' },
        { value: '2160p', label: '2160p' }
      ]
    },
    {
      id: 'falLtx2VideoDuration',
      order: 3,
      type: 'dropdown',
      name: sharedFieldText('duration'),
      default: 6,
      visible: {
        condition: 'falLtx2Mode !== "retake-video"'
      },
      options: [
        { value: 6, label: '6s' },
        { value: 8, label: '8s' },
        { value: 10, label: '10s' }
      ]
    },
    {
      id: 'falLtx2RetakeDuration',
      order: 4,
      type: 'number',
      name: sharedFieldText('retakeDuration'),
      default: 5,
      min: 2,
      max: 20,
      step: 1,
      visible: {
        condition: 'falLtx2Mode === "retake-video"'
      }
    },
    {
      id: 'falLtx2Fps',
      order: 5,
      type: 'dropdown',
      name: sharedFieldText('fps'),
      default: 25,
      visible: {
        condition: 'falLtx2Mode !== "retake-video"'
      },
      options: [
        { value: 25, label: '25 FPS' },
        { value: 50, label: '50 FPS' }
      ]
    },
    {
      id: 'falLtx2GenerateAudio',
      order: 6,
      type: 'switch',
      name: sharedFieldText('generateAudio'),
      default: true,
      visible: {
        condition: 'falLtx2Mode !== "retake-video"'
      }
    },
    {
      id: 'falLtx2FastMode',
      order: 7,
      type: 'switch',
      name: sharedFieldText('fastMode'),
      default: true,
      visible: {
        condition: 'falLtx2Mode !== "retake-video"'
      }
    },
    {
      id: 'falLtx2RetakeStartTime',
      order: 8,
      type: 'number',
      name: sharedFieldText('startTime'),
      default: 0,
      min: 0,
      max: 20,
      step: 1,
      visible: {
        condition: 'falLtx2Mode === "retake-video"'
      }
    },
    {
      id: 'falLtx2RetakeMode',
      order: 9,
      type: 'dropdown',
      name: sharedFieldText('retakeMode'),
      default: 'replace_audio_and_video',
      visible: {
        condition: 'falLtx2Mode === "retake-video"'
      },
      options: [
        { value: 'replace_audio', label: sharedOptionText('replaceAudio') },
        { value: 'replace_video', label: sharedOptionText('replaceVideo') },
        { value: 'replace_audio_and_video', label: sharedOptionText('replaceAudioAndVideo') }
      ]
    }
  ],
  linkages: [],
  endpoints: {
    selector: async (params) => {
      const mode = params.falLtx2Mode || 'text-to-video'
      const fastMode = params.falLtx2FastMode !== false
      if (mode === 'retake-video') {
        return 'fal-ai/ltx-2/retake-video'
      }
      if (mode === 'image-to-video') {
        return fastMode ? 'fal-ai/ltx-2/image-to-video/fast' : 'fal-ai/ltx-2/image-to-video'
      }
      return fastMode ? 'fal-ai/ltx-2/text-to-video/fast' : 'fal-ai/ltx-2/text-to-video'
    }
  },
  request: {
    builder: (params) => {
      const mode = params.falLtx2Mode || 'text-to-video'
      const images = params.images || []
      const prompt = params.prompt || ''
      const duration = params.falLtx2VideoDuration || 6
      const resolution = params.falLtx2Resolution || '1080p'
      const fps = params.falLtx2Fps || 25
      const generateAudio = params.falLtx2GenerateAudio !== false
      const retakeStartTime = params.falLtx2RetakeStartTime || 0
      const retakeMode = params.falLtx2RetakeMode || 'replace_audio_and_video'
      const retakeDuration = params.falLtx2RetakeDuration || duration
      const videoInput = params.video || (Array.isArray(params.videos) ? params.videos.find((v: DynamicValue) => typeof v === 'string' && v.startsWith('http')) : undefined)

      if (mode === 'retake-video') {
        return {
          prompt,
          video_url: videoInput,
          start_time: retakeStartTime,
          duration: retakeDuration,
          retake_mode: retakeMode
        }
      }

      const requestData: DynamicValue = {
        prompt,
        duration,
        resolution,
        aspect_ratio: '16:9',
        fps,
        generate_audio: generateAudio
      }

      if (mode === 'image-to-video' && images.length > 0) {
        requestData.image_url = images[0]
      }

      return requestData
    }
  },
  pricing: {
    currency: '$',
    calculator: () => 0.07,
    description: '基础价格 $0.07/次'
  }
})

export default ltx2Model;
