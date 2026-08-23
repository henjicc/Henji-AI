/** APIMart Midjourney 图生视频 */

import { defineModel, sharedFieldText } from '@/core'
import { hasUploadedImage } from '@/models/shared/mediaPresence'

export const apimartMidjourneyVideoModel = defineModel({
  meta: {
    id: 'apimart-midjourney-video', canonicalModelId: 'midjourney-video', seriesId: 'midjourney', seriesRank: 2,
    provider: 'apimart', type: 'video', i18nScope: 'models.defs.apimart-midjourney-video',
    name: { key: 'meta.name', fallback: 'Midjourney Video' },
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
      name: { zh: '来源任务 ID', en: 'Source Task ID' },
      description: { zh: '与上传首帧二选一', en: 'Use either a source task or an uploaded first frame' },
      default: '',
      visible: { condition: (params) => !hasUploadedImage(params) }
    },
    {
      id: 'apimartMidjourneyVideoIndex', type: 'dropdown', order: 11,
      name: { zh: '来源图索引', en: 'Source Image Index' }, default: '0',
      visible: {
        condition: (params) => !hasUploadedImage(params) &&
          typeof params.apimartMidjourneyVideoTaskId === 'string' &&
          params.apimartMidjourneyVideoTaskId.trim().length > 0
      },
      options: ['0', '1', '2', '3'].map((value, index) => ({
        value,
        label: { zh: `第 ${index + 1} 张`, en: `Image ${index + 1}` }
      }))
    },
    {
      id: 'apimartMidjourneyVideoResolution', type: 'dropdown', order: 1,
      name: sharedFieldText('resolution'), default: '480p',
      options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }]
    },
    {
      id: 'apimartMidjourneyVideoAnimateMode', type: 'dropdown', order: 12,
      name: { zh: '动画模式', en: 'Animate Mode' }, default: 'manual',
      options: [
        { value: 'manual', label: { zh: '手动', en: 'Manual' } },
        { value: 'auto', label: { zh: '自动', en: 'Automatic' } }
      ]
    },
    {
      id: 'apimartMidjourneyVideoMotion', type: 'dropdown', order: 13,
      name: { zh: '运动幅度', en: 'Motion' }, default: 'high',
      options: [{ value: 'low', label: { zh: '低', en: 'Low' } }, { value: 'high', label: { zh: '高', en: 'High' } }]
    },
    {
      id: 'apimartMidjourneyVideoBatchSize', type: 'dropdown', order: 2,
      name: { zh: '生成数量', en: 'Batch Size' }, default: '1',
      options: ['1', '2', '4'].map((value) => ({ value, label: value }))
    }
  ],
  paramPresentation: {
    groups: [{
      id: 'midjourney-animation-settings',
      name: { zh: '动画设置', en: 'Animation' },
      order: 3,
      panelWidth: 420,
      sections: [
        {
          id: 'source',
          name: { zh: '来源', en: 'Source' },
          paramIds: [
            'apimartMidjourneyVideoTaskId',
            'apimartMidjourneyVideoIndex'
          ]
        },
        {
          id: 'motion',
          name: { zh: '运动', en: 'Motion' },
          paramIds: [
            'apimartMidjourneyVideoAnimateMode',
            'apimartMidjourneyVideoMotion'
          ]
        }
      ]
    }]
  },
  linkages: [
    {
      trigger: ['uploadedImages', 'images'],
      effect: 'filterOptions',
      target: 'apimartMidjourneyVideoAnimateMode',
      filter: (_value, options, allParams) => hasUploadedImage(allParams)
        ? options.filter((option) => option.value === 'manual')
        : options
    },
    {
      trigger: ['uploadedImages', 'images'],
      effect: 'autoSwitch',
      target: 'apimartMidjourneyVideoAnimateMode',
      condition: (_value, allParams) => hasUploadedImage(allParams) &&
        allParams.apimartMidjourneyVideoAnimateMode !== 'manual',
      value: 'manual'
    }
  ],
  endpoints: '/v1/midjourney/generations/video',
  request: {
    builder: (params) => {
      const clean = (value: DynamicValue): string[] => Array.isArray(value)
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
      const body: DynamicValueMap = {
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
