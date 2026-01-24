/**
 * LTX 2 视频生成模型
 */

import { defineModel } from '@/core'

export const ltx2Model = defineModel({
  meta: {
    id: 'fal-ai-ltx-2',
    provider: 'fal',
    type: 'video',
    name: 'LTX 2',
    description: 'LTX 2 视频生成模型',
    tags: ['video', 'text-to-video', 'image-to-video']
  },
  params: [
    {
      id: 'falLtx2Mode',
      order: 1,
      type: 'dropdown',
      name: { zh: '模式', en: 'Mode' },
      default: 'text-to-video',
      options: [
        { value: 'text-to-video', label: { zh: '文生视频', en: 'Text to Video' } },
        { value: 'image-to-video', label: { zh: '图生视频', en: 'Image to Video' } },
        { value: 'retake-video', label: { zh: '视频编辑', en: 'Retake Video' } }
      ]
    },
    {
      id: 'falLtx2Resolution',
      order: 2,
      type: 'dropdown',
      name: { zh: '分辨率', en: 'Resolution' },
      default: '1080p',
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
      name: { zh: '时长', en: 'Duration' },
      default: 6,
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
      name: { zh: '编辑时长', en: 'Retake Duration' },
      default: 5,
      min: 2,
      max: 20,
      step: 1
    },
    {
      id: 'falLtx2Fps',
      order: 5,
      type: 'dropdown',
      name: { zh: '帧率', en: 'FPS' },
      default: 25,
      options: [
        { value: 25, label: '25 FPS' },
        { value: 50, label: '50 FPS' }
      ]
    },
    {
      id: 'falLtx2GenerateAudio',
      order: 6,
      type: 'switch',
      name: { zh: '生成音频', en: 'Generate Audio' },
      default: true
    },
    {
      id: 'falLtx2FastMode',
      order: 7,
      type: 'switch',
      name: { zh: '快速模式', en: 'Fast Mode' },
      default: true
    },
    {
      id: 'falLtx2RetakeStartTime',
      order: 8,
      type: 'number',
      name: { zh: '开始时间', en: 'Start Time' },
      default: 0,
      min: 0,
      max: 20,
      step: 1
    },
    {
      id: 'falLtx2RetakeMode',
      order: 9,
      type: 'dropdown',
      name: { zh: '编辑模式', en: 'Retake Mode' },
      default: 'replace_audio_and_video',
      options: [
        { value: 'replace_audio', label: { zh: '替换音频', en: 'Replace Audio' } },
        { value: 'replace_video', label: { zh: '替换视频', en: 'Replace Video' } },
        { value: 'replace_audio_and_video', label: { zh: '替换音频和视频', en: 'Replace Audio & Video' } }
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
      const videoInput = params.video || (Array.isArray(params.videos) ? params.videos.find((v: any) => typeof v === 'string' && v.startsWith('http')) : undefined)

      if (mode === 'retake-video') {
        return {
          prompt,
          video_url: videoInput,
          start_time: retakeStartTime,
          duration: retakeDuration,
          retake_mode: retakeMode
        }
      }

      const requestData: any = {
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
