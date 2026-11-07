/** APIMart Kling V4 文生、图生、参考生视频与视频编辑续写模型（运行时契约） */

import { defineModel } from '../defineModel'
import {
  countUploadedVideos, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources,
} from '../shared/mediaPresence'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['16:9', '9:16', '1:1', '21:9']
const MODES = ['text-image-to-video', 'reference-to-video', 'edit', 'extend']

function mode(params: JsonObject): string {
  const value = params.apimartKlingV4Mode
  return typeof value === 'string' && MODES.includes(value) ? value : 'text-image-to-video'
}

function duration(params: JsonObject): number {
  return Math.min(30, Math.max(3, Math.round(Number(params.apimartKlingV4Duration || 5))))
}

function audioSources(params: JsonObject): string[] {
  const pick = (value: JsonValue): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const uploaded = pick(params.uploadedAudioFilePaths)
  return uploaded.length > 0 ? uploaded : pick(params.audios)
}

/** 输入视频秒数按各段相加后向上取整，最多计 30 秒；拿不到时长时按输出时长估算。 */
function inputVideoSeconds(params: JsonObject, fallback: number): number {
  const seconds = resolveUploadedVideoDurationSeconds(params)
  return Math.min(30, Math.ceil(seconds > 0 ? seconds : fallback))
}

export const apimartKlingV4Model = defineModel({
  meta: {
    id: 'apimart-kling-4.0', canonicalModelId: 'kling-video-4.0', seriesId: 'kling-video', seriesRank: 4,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'video-to-video', 'video-extension'],
    polling: { interval: 5000, maxAttempts: 300, expectedAttempts: 60 },
  },
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [
      { when: 'apimartKlingV4Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 }, audios: { max: 3 } },
      { when: 'apimartKlingV4Mode === "edit"', images: { max: 10 }, videos: { exact: 1 } },
      { when: 'apimartKlingV4Mode === "extend"', images: { max: 1 }, videos: { exact: 1 } },
      { videoConstraints: { maxDurationSec: 30 } },
    ],
  },
  requirements: [{
    id: 'apimart-kling-v4-input-video',
    when: 'apimartKlingV4Mode === "edit" || apimartKlingV4Mode === "extend"',
    require: { videos: { exact: 1 } },
    message: { title: '需要输入视频', message: '视频编辑和续写需要 1 段输入视频。', type: 'warning' },
  }],
  params: [
    { id: 'apimartKlingV4Mode', type: 'dropdown', order: 1, default: 'text-image-to-video', options: MODES.map(value => ({ value })) },
    {
      id: 'apimartKlingV4AspectRatio', type: 'dropdown', order: 2, default: 'smart',
      options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))],
      visible: { condition: 'apimartKlingV4Mode !== "extend"' },
    },
    { id: 'apimartKlingV4Resolution', type: 'dropdown', order: 3, default: '720p', options: ['720p', '1080p'].map(value => ({ value })) },
    // 视频编辑不传时长时输出跟随输入视频，计费也按输入视频计算。
    {
      id: 'apimartKlingV4Duration', type: 'number', order: 4, default: 5, min: 3, max: 30, step: 1,
      visible: { condition: 'apimartKlingV4Mode !== "edit"' },
    },
    {
      id: 'apimartKlingV4KeepOriginalSound', type: 'switch', order: 5, default: true,
      visible: { condition: 'apimartKlingV4Mode === "edit"' },
    },
  ],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      const current = mode(params)
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      const audios = audioSources(params)
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      const rawRatio = String(params.apimartKlingV4AspectRatio || 'smart')
      const fixedRatio = RATIOS.includes(rawRatio) ? rawRatio : undefined
      const body: JsonObject = {
        model: 'kling-v4',
        resolution: params.apimartKlingV4Resolution === '1080p' ? '1080p' : '720p',
      }
      if (prompt) body.prompt = prompt
      else if (current !== 'text-image-to-video' || images.length === 0) throw new Error('Kling V4 除图生视频外都需要填写提示词')

      if (current === 'edit' || current === 'extend') {
        if (videos.length !== 1) throw new Error('Kling V4 视频编辑和续写需要 1 段输入视频')
        body.omni_reference_task_type = current
        body.video_url = videos[0]
        if (current === 'edit') {
          if (images.length > 0) body.image_urls = images.slice(0, 10)
          if (fixedRatio) body.aspect_ratio = fixedRatio
          body.audio_setting = params.apimartKlingV4KeepOriginalSound === false ? 'auto' : 'origin'
        } else {
          body.duration = duration(params)
          if (images.length > 0) body.last_frame_image = images[0]
        }
        return body
      }

      body.duration = duration(params)
      if (current === 'reference-to-video') {
        if (images.length + videos.length + audios.length === 0) throw new Error('Kling V4 参考生视频至少需要一份参考素材')
        if (images.length + videos.length + audios.length > 15) throw new Error('Kling V4 参考图、视频和音频合计最多 15 个')
        body.omni_reference_task_type = 'reference'
        body.aspect_ratio = fixedRatio ?? 'auto'
        if (images.length > 0) body.image_urls = images.slice(0, 10)
        if (videos.length > 0) body.video_urls = videos.slice(0, 5)
        if (audios.length > 0) body.audio_urls = audios.slice(0, 3)
        return body
      }

      if (images.length > 0) {
        body.image_urls = images.slice(0, 2)
        // 图生视频默认跟随首帧比例，只有用户明确选择时才覆盖。
        if (fixedRatio) body.aspect_ratio = fixedRatio
      } else {
        body.aspect_ratio = fixedRatio ?? '16:9'
      }
      return body
    },
  },
  pricing: {
    currency: '$',
    calculator: (params) => {
      const current = mode(params)
      const fullHd = params.apimartKlingV4Resolution === '1080p'
      const outputRate = fullHd ? 0.21 : 0.14
      const videoInputRate = fullHd ? 0.126 : 0.084
      if (current === 'edit') {
        const seconds = inputVideoSeconds(params, 5)
        return videoInputRate * (seconds + seconds)
      }
      const output = duration(params)
      if (current === 'reference-to-video' && countUploadedVideos(params) > 0) {
        return videoInputRate * (output + Math.max(output, inputVideoSeconds(params, output)))
      }
      return outputRate * output
    },
    description: '720p $0.14/秒、1080p $0.21/秒；视频编辑与带参考视频的参考生视频按视频输入单价 720p $0.084 / 1080p $0.126，计费秒数为输出秒数 + max(输出秒数, 输入视频秒数)；续写只按新增秒数计费',
  },
})

export default apimartKlingV4Model
