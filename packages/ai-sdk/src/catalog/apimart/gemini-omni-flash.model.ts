/** APIMart Gemini Omni Flash 官方与 Ext 渠道统一模型（运行时契约） */

import { defineModel } from '../defineModel'
import { countUploadedVideos, resolveUploadedImageSources, resolveUploadedVideoSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

export const apimartGeminiOmniFlashModel = defineModel({
  meta: {
    id: 'apimart-gemini-omni-flash', canonicalModelId: 'gemini-omni-video',
    seriesId: 'gemini-omni', seriesRank: 1, provider: 'apimart', type: 'video',
    tags: [
      'text-to-video', 'image-to-video', 'video-to-video', 'supports-video-editing',
      'supports-multi-image', 'mixed-upload-mode', 'supports-4k', 'provider-apimart'
    ],
    aliases: [
      'gemini-omni-flash-apimart',
      'apimart-gemini-omni-flash-ext',
      'omni-flash-ext',
      'gemini-omni-flash-ext-apimart'
    ],
    aliasParamDefaults: {
      'apimart-gemini-omni-flash-ext': { apimartGeminiOmniFlashChannel: 'ext' },
      'omni-flash-ext': { apimartGeminiOmniFlashChannel: 'ext' },
      'gemini-omni-flash-ext-apimart': { apimartGeminiOmniFlashChannel: 'ext' }
    },
    aliasParamMappings: {
      'apimart-gemini-omni-flash': {
        apimartGeminiOmniFlashDuration: 'apimartGeminiOmniFlashOfficialDuration'
      },
      'apimart-gemini-omni-flash-ext': {
        apimartGeminiOmniFlashExtGenerationType: 'apimartGeminiOmniFlashGenerationType',
        apimartGeminiOmniFlashExtAspectRatio: 'apimartGeminiOmniFlashAspectRatio',
        apimartGeminiOmniFlashExtResolution: 'apimartGeminiOmniFlashResolution'
      }
    },
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 60 }
  },
  inputLimits: {
    images: { max: 16 }, videos: { max: 1 },
    rules: [{
      when: 'apimartGeminiOmniFlashChannel === "ext"',
      images: { max: 3 }
    }, {
      when: 'apimartGeminiOmniFlashChannel === "ext" && apimartGeminiOmniFlashGenerationType === "frame"',
      images: { max: 1 }
    }]
  },
  requirements: [{
    id: 'apimart-gemini-omni-ext-prompt',
    when: 'apimartGeminiOmniFlashChannel === "ext"',
    require: { prompt: true },
    message: { title: '提示词必需', message: '普通渠道需要填写提示词。', type: 'warning' }
  }],
  params: [
    {
      id: 'apimartGeminiOmniFlashChannel', type: 'dropdown', order: 1,
      default: 'official',
      options: [
        { value: 'official' },
        { value: 'ext' }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashAspectRatio', type: 'dropdown', order: 2,
      default: '16:9',
      options: [{ value: '16:9' }, { value: '9:16' }]
    },
    {
      id: 'apimartGeminiOmniFlashResolution', type: 'dropdown', order: 3,
      default: '720p',
      options: [
        { value: '360p' },
        { value: '720p' },
        { value: '1080p' },
        { value: '4k' }
      ]
    },
    {
      id: 'apimartGeminiOmniFlashOfficialDuration', type: 'number', order: 4,
      default: 5, min: 3, max: 10, step: 1,
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel !== 'ext' }
    },
    {
      id: 'apimartGeminiOmniFlashExtDuration', type: 'dropdown', order: 4,
      default: '6',
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel === 'ext' },
      options: ['4', '6', '8', '10'].map((value) => ({ value }))
    },
    {
      id: 'apimartGeminiOmniFlashGenerationType', type: 'dropdown', order: 5,
      default: 'reference',
      visible: { condition: (params) => params.apimartGeminiOmniFlashChannel === 'ext' },
      options: [
        { value: 'reference' },
        { value: 'frame' }
      ]
    }
    // extend_from_task_id（多轮延续）要填供应商侧的上一次任务 ID，界面不展示任务 ID、用户也拿不到：
    // 按“不显示且不请求”处理（界面计划 5.8，P-17）；以后做成生成记录上的“继续编辑”动作再接入
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      if (videos.length > 1) throw new Error('Gemini Omni Flash 只支持一段参考视频')
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      const aspectRatio = params.apimartGeminiOmniFlashAspectRatio === '9:16' ? '9:16' : '16:9'
      const channel = params.apimartGeminiOmniFlashChannel === 'ext' ? 'ext' : 'official'

      if (channel === 'ext') {
        if (!prompt) throw new Error('Gemini Omni Flash 普通渠道的提示词不能为空')
        if (images.length === 2 || images.length > 3) {
          throw new Error('Gemini Omni Flash 普通渠道只支持 0、1 或 3 张图片')
        }
        const generationType = params.apimartGeminiOmniFlashGenerationType === 'frame' ? 'frame' : 'reference'
        if (generationType === 'frame' && images.length > 1) {
          throw new Error('Gemini Omni Flash 普通渠道的首帧模式只能传入 1 张图片')
        }
        const resolution = params.apimartGeminiOmniFlashResolution === '360p'
          || params.apimartGeminiOmniFlashResolution === '1080p'
          || params.apimartGeminiOmniFlashResolution === '4k'
          ? params.apimartGeminiOmniFlashResolution
          : '720p'
        const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
          ? Number(params.apimartGeminiOmniFlashExtDuration)
          : 6
        const body: JsonObject = {
          model: 'gemini-omni-1.1-flash-ext', prompt, resolution, aspect_ratio: aspectRatio, nsfw_check: false
        }
        if (videos.length === 0) body.duration = duration
        if (images.length > 0) {
          body.generation_type = generationType
          body.image_urls = images
        }
        if (videos.length > 0) body.video_urls = videos.slice(0, 1)
        return body
      }

      if (!prompt && images.length + videos.length === 0) {
        throw new Error('Gemini Omni Flash 官方渠道至少需要提示词或一份参考素材')
      }
      if (images.length > 16) throw new Error('Gemini Omni Flash 官方渠道最多支持 16 张参考图')
      const body: JsonObject = {
        model: 'gemini-omni-flash-preview',
        prompt,
        duration: Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashOfficialDuration || 5)))),
        aspect_ratio: aspectRatio,
        resolution: '720p'
      }
      if (images.length > 0) body.image_urls = images
      if (videos.length > 0) body.video_urls = videos.slice(0, 1)
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      if (params.apimartGeminiOmniFlashChannel !== 'ext') {
        return Math.min(10, Math.max(3, Math.round(Number(params.apimartGeminiOmniFlashOfficialDuration || 5)))) * 0.088
      }
      const resolution = params.apimartGeminiOmniFlashResolution === '4k' ? '4k'
        : params.apimartGeminiOmniFlashResolution === '360p' ? '360p' : 'standard'
      if (countUploadedVideos(params) > 0) return resolution === '4k' ? 0.24 : resolution === '360p' ? 0.04 : 0.08
      const duration = ['4', '6', '8', '10'].includes(String(params.apimartGeminiOmniFlashExtDuration))
        ? String(params.apimartGeminiOmniFlashExtDuration)
        : '6'
      const standard: Record<string, number> = { '4': 0.25, '6': 0.3, '8': 0.35, '10': 0.4 }
      const high4k: Record<string, number> = { '4': 0.75, '6': 0.8, '8': 0.85, '10': 0.9 }
      const low360: Record<string, number> = { '4': 0.15, '6': 0.175, '8': 0.2, '10': 0.225 }
      return (resolution === '4k' ? high4k : resolution === '360p' ? low360 : standard)[duration]
    },
    description: '官方渠道 720p $0.088/秒；普通渠道按分辨率、时长或参考视频档位计费'
  }
})

export default apimartGeminiOmniFlashModel
