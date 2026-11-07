/** APIMart Gemini Omni 1.2 Flash 官方与 Ext 渠道统一模型（运行时契约） */

import { readContinuation } from '../continuation'
import { defineModel } from '../defineModel'
import {
  hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources,
} from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

const MODES = ['text-image-to-video', 'reference-to-video', 'edit', 'extend']
const EXTEND = 'extend'
// 宿主在三种场景下存放已上传素材的键；续写自己的结果时源任务已经给出视频，源请求的图和视频不能带过去。
const MEDIA_KEYS = [
  'uploadedFilePaths', 'images', 'uploadedImages', 'uploadedVideoFilePaths', 'videos', 'uploadedVideos',
  '__videoDurationSeconds', '__totalVideoDurationSeconds', '__firstVideoDurationSeconds',
]
const RESOLUTIONS = ['360p', '720p', '1080p', '4k']
const RATES: Record<string, Record<string, number>> = {
  official: { '360p': 0.02, '720p': 0.06, '1080p': 0.0904, '4k': 0.1808 },
  ext: { '360p': 0.016, '720p': 0.024, '1080p': 0.024, '4k': 0.056 },
}

/** 续写自己上一次的结果，平台按 extend_from_task_id 取源视频，不需要再上传。 */
function extendFromTaskId(params: JsonObject): string | null {
  const taskId = readContinuation(params, EXTEND)?.reference.taskId
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null
}

function isContinued(params: JsonObject): boolean {
  return extendFromTaskId(params) !== null
}

function mode(params: JsonObject): string {
  if (isContinued(params)) return 'extend'
  const value = params.apimartGeminiOmni12Mode
  return typeof value === 'string' && MODES.includes(value) ? value : 'text-image-to-video'
}

function channel(params: JsonObject): 'official' | 'ext' {
  return params.apimartGeminiOmni12Channel === 'ext' ? 'ext' : 'official'
}

/** 首尾帧插值与续写只支持 3–10 秒，其余生成模式支持 3–15 秒。 */
function duration(params: JsonObject, images: number): number {
  const current = mode(params)
  const max = current === 'extend' || (current === 'text-image-to-video' && images >= 2) ? 10 : 15
  return Math.min(max, Math.max(3, Math.round(Number(params.apimartGeminiOmni12Duration || 10))))
}

export const apimartGeminiOmni12FlashModel = defineModel({
  meta: {
    id: 'apimart-gemini-omni-1.2-flash', canonicalModelId: 'gemini-omni-1.2-flash',
    seriesId: 'gemini-omni', seriesRank: 1.2, provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'video-to-video', 'video-extension'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 40 },
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 },
    rules: [
      { when: 'apimartGeminiOmni12Channel === "ext" && apimartGeminiOmni12Mode === "text-image-to-video"', images: { max: 1 } },
      { when: 'apimartGeminiOmni12Mode === "reference-to-video"', images: { max: 10 } },
      { when: 'apimartGeminiOmni12Mode === "edit" || apimartGeminiOmni12Mode === "extend"', images: { max: 0 }, videos: { exact: 1 } },
      { when: isContinued, images: { max: 0 }, videos: { exact: 0 } },
      { videoConstraints: { maxDurationSec: 15 } },
    ],
  },
  requirements: [{
    id: 'apimart-gemini-omni-12-prompt',
    require: { prompt: true },
    message: { title: '提示词必需', message: '所有模式都需要填写提示词。', type: 'warning' },
  }, {
    id: 'apimart-gemini-omni-12-input-video',
    when: (params) => !isContinued(params) && (mode(params) === 'edit' || mode(params) === 'extend'),
    require: { videos: { exact: 1 } },
    message: { title: '需要输入视频', message: '视频编辑和续写需要 1 段输入视频。', type: 'warning' },
  }],
  params: [
    // 续写只能接同渠道的源任务（Ext 只认本账号已完成的 Ext 任务），续写时渠道与模式沿用源任务，不让改。
    {
      id: 'apimartGeminiOmni12Channel', type: 'dropdown', order: 1, default: 'official', options: [{ value: 'official' }, { value: 'ext' }],
      visible: { condition: (params) => !isContinued(params) },
    },
    {
      id: 'apimartGeminiOmni12Mode', type: 'dropdown', order: 2, default: 'text-image-to-video', options: MODES.map(value => ({ value })),
      visible: { condition: (params) => !isContinued(params) },
    },
    // 编辑与续写的画幅跟随输入视频；Ext 渠道带图时不传比例即跟随素材。这两种情况不显示也不发送比例。
    {
      id: 'apimartGeminiOmni12AspectRatio', type: 'dropdown', order: 3, default: '16:9', options: [{ value: '16:9' }, { value: '9:16' }],
      visible: {
        condition: (params) => mode(params) !== 'edit' && mode(params) !== 'extend' && !(channel(params) === 'ext' && hasUploadedImage(params)),
      },
    },
    { id: 'apimartGeminiOmni12Resolution', type: 'dropdown', order: 4, default: '720p', options: RESOLUTIONS.map(value => ({ value })) },
    // 编辑时输出时长跟随源视频，不能传 duration。
    {
      id: 'apimartGeminiOmni12Duration', type: 'number', order: 5, default: 10, min: 3, max: 15, step: 1,
      visible: { condition: (params) => mode(params) !== 'edit' },
    },
  ],
  continuations: [{
    id: EXTEND,
    capture: ({ taskId }) => taskId ? { taskId } : null,
    params: (source) => {
      const next: JsonObject = { ...source, apimartGeminiOmni12Mode: 'extend' }
      for (const key of MEDIA_KEYS) delete next[key]
      // 续写新增片段最长 10 秒。
      const seconds = Number(source.apimartGeminiOmni12Duration)
      if (Number.isFinite(seconds) && seconds > 10) next.apimartGeminiOmni12Duration = 10
      return next
    },
    submit: 'edit',
  }],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const current = mode(params)
      const route = channel(params)
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('Gemini Omni 1.2 Flash 的所有模式都需要提示词')
      const resolution = RESOLUTIONS.includes(String(params.apimartGeminiOmni12Resolution))
        ? String(params.apimartGeminiOmni12Resolution) : '720p'
      const body: JsonObject = {
        model: route === 'ext' ? 'gemini-omni-1.2-flash-ext' : 'gemini-omni-1.2-flash',
        prompt,
        resolution,
      }

      const fromTaskId = extendFromTaskId(params)
      if (fromTaskId) {
        // 与 video_urls 互斥；渠道沿用源任务，跨渠道续写会被平台拒绝。
        return { ...body, extend_from_task_id: fromTaskId, omni_reference_task_type: 'extend', duration: duration(params, 0) }
      }
      if (current === 'edit' || current === 'extend') {
        if (videos.length !== 1) throw new Error('Gemini Omni 1.2 Flash 视频编辑和续写需要 1 段输入视频')
        body.video_urls = videos
        body.omni_reference_task_type = current
        if (current === 'extend') body.duration = duration(params, 0)
        return body
      }

      if (route !== 'ext' || images.length === 0) body.aspect_ratio = params.apimartGeminiOmni12AspectRatio === '9:16' ? '9:16' : '16:9'
      body.duration = duration(params, images.length)
      if (current === 'reference-to-video') {
        if (images.length === 0) throw new Error('Gemini Omni 1.2 Flash 多图参考至少需要 1 张参考图')
        if (images.length > 10) throw new Error('Gemini Omni 1.2 Flash 最多支持 10 张参考图')
        body.image_urls = images
        body.omni_reference_task_type = 'reference'
        return body
      }

      if (images.length > (route === 'ext' ? 1 : 2)) {
        throw new Error(route === 'ext' ? 'Gemini Omni 1.2 Flash Ext 渠道不支持尾帧' : 'Gemini Omni 1.2 Flash 首尾帧最多 2 张图片')
      }
      if (images[0]) body.first_frame_image = images[0]
      if (images[1]) body.last_frame_image = images[1]
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const rates = RATES[channel(params)]
      const resolution = RESOLUTIONS.includes(String(params.apimartGeminiOmni12Resolution))
        ? String(params.apimartGeminiOmni12Resolution) : '720p'
      if (mode(params) === 'edit') {
        const seconds = resolveUploadedVideoDurationSeconds(params)
        return rates[resolution] * Math.max(1, Math.ceil(seconds > 0 ? seconds - 0.15 : 10))
      }
      return rates[resolution] * duration(params, resolveUploadedImageSources(params).length)
    },
    description: '官方渠道 360p $0.02、720p $0.06、1080p $0.0904、4k $0.1808 每秒；Ext 渠道 360p $0.016、720p/1080p $0.024、4k $0.056 每秒；编辑按源视频秒数计费，续写只按新增秒数计费',
  },
})

export default apimartGeminiOmni12FlashModel
