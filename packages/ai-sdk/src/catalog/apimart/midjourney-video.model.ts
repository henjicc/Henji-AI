/** APIMart Midjourney 图生视频（运行时契约） */

import { CONTINUATION_PARAM } from '../../types/model'
import { readContinuation } from '../continuation'
import { defineModel } from '../defineModel'
import type { JsonValue, JsonObject } from '../../types/runtime'

const ANIMATE = 'animate'

/** 从 Midjourney 图片结果续接时，平台用来源任务的四宫格作首帧。 */
function continuedTaskId(params: JsonObject): string {
  const taskId = readContinuation(params, ANIMATE)?.reference.taskId
  return typeof taskId === 'string' ? taskId.trim() : ''
}

function isContinued(params: JsonObject): boolean {
  return continuedTaskId(params).length > 0
}

export const apimartMidjourneyVideoModel = defineModel({
  meta: {
    id: 'apimart-midjourney-video', canonicalModelId: 'midjourney-video', seriesId: 'midjourney', seriesRank: 2,
    provider: 'apimart', type: 'video',
    tags: ['image-to-video', 'start-end-frame'],
    aliases: ['midjourney-video-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
  },
  // 旧工程里手填的来源任务 ID 仍算有效输入，请求构建兼容读取它。
  alternativeInputParamIds: [CONTINUATION_PARAM, 'apimartMidjourneyVideoTaskId'],
  inputLimits: (params) => ({
    images: { max: isContinued(params) ? 0 : 2 },
    videos: { max: 0 },
    audios: { max: 0 }
  }),
  params: [
    {
      id: 'apimartMidjourneyVideoIndex', type: 'dropdown', order: 11,
      default: '0',
      visible: { condition: isContinued },
      options: ['0', '1', '2', '3'].map((value) => ({ value }))
    },
    {
      id: 'apimartMidjourneyVideoResolution', type: 'dropdown', order: 1,
      default: '480p',
      options: [{ value: '480p' }, { value: '720p' }]
    },
    {
      // 自动动画由平台按来源任务自行写运动提示，官方要求必须有 task_id，上传首帧时不可用。
      id: 'apimartMidjourneyVideoAnimateMode', type: 'dropdown', order: 12,
      default: 'manual',
      visible: { condition: isContinued },
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
      const continued = continuedTaskId(params)
      const images = continued ? [] : uploaded.length > 0 ? uploaded : clean(params.images)
      // 旧工程可能存着手填的来源任务 ID；参数已不再显示，只在没有续接与首帧时继续读取，保证旧工程能照常提交。
      const legacyTaskId = typeof params.apimartMidjourneyVideoTaskId === 'string'
        ? params.apimartMidjourneyVideoTaskId.trim()
        : ''
      const taskId = continued || (images.length === 0 ? legacyTaskId : '')
      if (images.length === 0 && !taskId) throw new Error('Midjourney Video 需要上传首帧，或从 Midjourney 图片结果做成视频')
      const resolution = params.apimartMidjourneyVideoResolution === '720p' ? '720' : '480'
      const hasEndFrame = images.length > 1
      const body: JsonObject = {
        prompt: typeof params.prompt === 'string' ? params.prompt.trim() : '',
        video_type: `vid_1.1_i2v_${hasEndFrame ? 'start_end_' : ''}${resolution}`,
        animate_mode: taskId && params.apimartMidjourneyVideoAnimateMode === 'auto' ? 'auto' : 'manual',
        motion: params.apimartMidjourneyVideoMotion === 'low' ? 'low' : 'high',
        batch_size: ['2', '4'].includes(String(params.apimartMidjourneyVideoBatchSize))
          ? Number(params.apimartMidjourneyVideoBatchSize)
          : 1
      }
      if (taskId) {
        body.task_id = taskId
        // 视频端点的 index 是 0–3，与其他 Midjourney 端点的 1–4 不同。
        body.index = Math.min(3, Math.max(0, Number(params.apimartMidjourneyVideoIndex || 0)))
      } else {
        body.image_urls = [images[0]]
        if (images[1]) body.end_url = images[1]
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
