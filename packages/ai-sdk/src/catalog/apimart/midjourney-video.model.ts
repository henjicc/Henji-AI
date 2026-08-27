/** APIMart Midjourney 图生视频（运行时契约） */

import { defineModel } from '../defineModel'
import { hasUploadedImage } from '../shared/mediaPresence'
import type { JsonValue, JsonObject } from '../../types/runtime'

export const apimartMidjourneyVideoModel = defineModel({
  meta: {
    id: 'apimart-midjourney-video', canonicalModelId: 'midjourney-video', seriesId: 'midjourney', seriesRank: 2,
    provider: 'apimart', type: 'video',
    tags: ['image-to-video', 'start-end-frame', 'multi-mode-switch', 'provider-apimart'],
    aliases: ['midjourney-video-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  alternativeInputParamIds: ['apimartMidjourneyVideoTaskId'],
  inputLimits: (params) => ({
    images: {
      max: typeof params.apimartMidjourneyVideoTaskId === 'string' &&
        params.apimartMidjourneyVideoTaskId.trim().length > 0 &&
        !hasUploadedImage(params)
        ? 0
        : 2
    },
    videos: { max: 0 },
    audios: { max: 0 }
  }),
  params: [
    {
      id: 'apimartMidjourneyVideoTaskId', type: 'text', order: 10,
      default: '',
      visible: { condition: (params) => !hasUploadedImage(params) }
    },
    {
      id: 'apimartMidjourneyVideoIndex', type: 'dropdown', order: 11,
      default: '0',
      visible: {
        condition: (params) => !hasUploadedImage(params) &&
          typeof params.apimartMidjourneyVideoTaskId === 'string' &&
          params.apimartMidjourneyVideoTaskId.trim().length > 0
      },
      options: ['0', '1', '2', '3'].map((value) => ({ value }))
    },
    {
      id: 'apimartMidjourneyVideoResolution', type: 'dropdown', order: 1,
      default: '480p',
      options: [{ value: '480p' }, { value: '720p' }]
    },
    {
      id: 'apimartMidjourneyVideoAnimateMode', type: 'dropdown', order: 12,
      default: 'manual',
      options: [
        { value: 'manual' },
        { value: 'auto' }
      ]
    },
    {
      id: 'apimartMidjourneyVideoMotion', type: 'dropdown', order: 13,
      default: 'high',
      options: [{ value: 'low' }, { value: 'high' }]
    },
    {
      id: 'apimartMidjourneyVideoBatchSize', type: 'dropdown', order: 2,
      default: '1',
      options: ['1', '2', '4'].map((value) => ({ value }))
    }
  ],
  endpoints: '/v1/midjourney/generations/video',
  request: {
    builder: (params) => {
      const clean = (value: JsonValue): string[] => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      const uploaded = clean(params.uploadedFilePaths)
      const images = uploaded.length > 0 ? uploaded : clean(params.images)
      const taskId = typeof params.apimartMidjourneyVideoTaskId === 'string'
        ? params.apimartMidjourneyVideoTaskId.trim()
        : ''
      if (images.length === 0 && !taskId) throw new Error('Midjourney Video 需要上传首帧或提供来源任务 ID')
      const resolution = params.apimartMidjourneyVideoResolution === '720p' ? '720' : '480'
      const hasEndFrame = images.length > 1
      const body: JsonObject = {
        prompt: typeof params.prompt === 'string' ? params.prompt.trim() : '',
        video_type: `vid_1.1_i2v_${hasEndFrame ? 'start_end_' : ''}${resolution}`,
        animate_mode: images.length === 0 && params.apimartMidjourneyVideoAnimateMode === 'auto' ? 'auto' : 'manual',
        motion: params.apimartMidjourneyVideoMotion === 'low' ? 'low' : 'high',
        batch_size: ['2', '4'].includes(String(params.apimartMidjourneyVideoBatchSize))
          ? Number(params.apimartMidjourneyVideoBatchSize)
          : 1
      }
      if (images.length > 0) {
        body.image_urls = [images[0]]
        if (images[1]) body.end_url = images[1]
      } else {
        body.task_id = taskId
        body.index = Math.min(3, Math.max(0, Number(params.apimartMidjourneyVideoIndex || 0)))
      }
      if (body.animate_mode === 'auto' && !taskId) {
        throw new Error('Midjourney Video 的自动动画模式必须使用来源任务 ID')
      }
      return body
    }
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const batchSize = ['2', '4'].includes(String(params.apimartMidjourneyVideoBatchSize))
        ? Number(params.apimartMidjourneyVideoBatchSize)
        : 1
      return batchSize * (params.apimartMidjourneyVideoResolution === '720p' ? 0.4 : 0.2)
    },
    description: '480p $0.2/条，720p $0.4/条；按 batch_size 倍增'
  }
})

export default apimartMidjourneyVideoModel
