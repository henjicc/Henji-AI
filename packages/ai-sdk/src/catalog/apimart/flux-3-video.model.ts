/** APIMart FLUX 3 Video 统一模型（运行时契约） */

import { readContinuation } from '../continuation'
import { defineModel } from '../defineModel'
import { hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoSources } from '../shared/mediaPresence'
import type { JsonObject } from '../../types/runtime'

// 字段、限制与价格来源：docs/model-adaptation/FLUX-3-Video/FLUX-3-Video_APIMart.md（2026-11-07 读取）。
const RATIOS = ['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16']
const RATES: Record<string, Record<string, number>> = {
  generate: { hd: 0.136, fhd: 0.232 },
  extend: { hd: 0.328, fhd: 0.424 },
}
// 草稿只出 hd，单价不分档。
const DRAFT_RATES = { generate: 0.048, extend: 0.096 }
const FINALIZE_DRAFT = 'finalize-draft'

function isExtend(params: JsonObject): boolean {
  return params.apimartFlux3VideoMode === 'extend'
}

function isDraft(params: JsonObject): boolean {
  return params.apimartFlux3VideoDraft === true
}

function resolution(params: JsonObject): 'hd' | 'fhd' {
  return params.apimartFlux3VideoResolution === 'fhd' ? 'fhd' : 'hd'
}

function duration(params: JsonObject): number {
  const value = Number(params.apimartFlux3VideoDuration ?? 5)
  return Number.isFinite(value) ? Math.min(20, Math.max(5, Math.round(value))) : 5
}

function draftTaskId(params: JsonObject): string | null {
  const taskId = readContinuation(params, FINALIZE_DRAFT)?.reference.taskId
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null
}

export const apimartFlux3VideoModel = defineModel({
  meta: {
    id: 'apimart-flux-3-video', canonicalModelId: 'flux-3-video', seriesId: 'flux', seriesRank: 3,
    provider: 'apimart', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'video-extension'],
    polling: { interval: 5000, maxAttempts: 180, expectedAttempts: 12 },
  },
  // 转正片只认草稿任务，不收素材；续写模式的“需要 1 段视频”在转正片时不适用。
  inputLimits: (params) => readContinuation(params, FINALIZE_DRAFT)
    ? { images: { max: 0 }, videos: { max: 0 } }
    : params.apimartFlux3VideoMode === 'extend'
      ? { images: { max: 0 }, videos: { exact: 1 } }
      : { images: { max: 10 }, videos: { max: 0 } },
  params: [
    { id: 'apimartFlux3VideoMode', type: 'dropdown', order: 1, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'extend' }] },
    {
      id: 'apimartFlux3VideoAspectRatio', type: 'dropdown', order: 2, default: 'smart',
      visible: { condition: (params: JsonObject) => !isExtend(params) && !hasUploadedImage(params) },
      options: [{ value: 'smart' }, ...RATIOS.map(value => ({ value }))],
    },
    // 草稿固定 hd；开草稿时这里是转正片时的分辨率，转正片只允许改它。
    { id: 'apimartFlux3VideoResolution', type: 'dropdown', order: 3, default: 'hd', options: [{ value: 'hd' }, { value: 'fhd' }] },
    { id: 'apimartFlux3VideoDuration', type: 'number', order: 4, default: 5, min: 5, max: 20, step: 1 },
    { id: 'apimartFlux3VideoAudio', type: 'switch', order: 5, default: true },
    { id: 'apimartFlux3VideoDraft', type: 'switch', order: 6, default: false },
  ],
  continuations: [{
    id: FINALIZE_DRAFT,
    available: isDraft,
    capture: ({ taskId }) => taskId ? { taskId } : null,
    params: source => ({ ...source, apimartFlux3VideoDraft: false }),
    submit: 'direct',
  }],
  endpoints: '/v1/videos/generations',
  request: {
    builder: (params) => {
      // 转正片沿用草稿保存的模式、提示词、时长与素材，官方只允许再改分辨率，传 prompt 会被拒绝。
      const fromDraft = draftTaskId(params)
      if (fromDraft) return { model: 'flux-3-video', draft_from_task_id: fromDraft, resolution: resolution(params) }

      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
      if (!prompt) throw new Error('请输入 FLUX 3 Video 提示词')
      const images = resolveUploadedImageSources(params)
      const videos = resolveUploadedVideoSources(params)
      const body: JsonObject = {
        model: 'flux-3-video',
        prompt,
        duration: duration(params),
        resolution: isDraft(params) ? 'hd' : resolution(params),
        audio: params.apimartFlux3VideoAudio !== false,
      }
      if (isDraft(params)) body.draft = true
      // 显式 mode 优先级最高，避免平台在“同时有图和视频”时按续写处理而静默丢图。
      if (isExtend(params)) {
        if (videos.length !== 1) throw new Error('FLUX 3 Video 视频续写需要 1 段视频')
        body.mode = 'v2v'
        body.video_url = videos[0]
      } else if (images.length > 0) {
        if (images.length > 10) throw new Error('FLUX 3 Video 最多支持 10 张关键帧')
        body.mode = 'i2v'
        // 顺序即语义：首张起始帧、末张结束帧，中间均匀分布。
        body.image_urls = images
      } else {
        body.mode = 't2v'
      }
      const raw = String(params.apimartFlux3VideoAspectRatio || 'smart')
      // 有图或续写时比例选项已隐藏，残留的取值也不能发，交给平台按素材选比例；纯文生视频回退 16:9。
      body.aspect_ratio = body.mode !== 't2v' ? 'auto' : RATIOS.includes(raw) ? raw : '16:9'
      return body
    },
  },
  pricing: {
    currency: '$',
    // 转正片按正片全价计费、草稿费用不抵扣；时长与模式沿用草稿的参数。
    calculator: (params) => {
      const kind = isExtend(params) ? 'extend' : 'generate'
      if (isDraft(params) && !draftTaskId(params)) return DRAFT_RATES[kind] * duration(params)
      return RATES[kind][resolution(params)] * duration(params)
    },
    description: '文/图生视频每秒 HD $0.136、FHD $0.232；视频续写每秒 HD $0.328、FHD $0.424；草稿每秒 $0.048（续写草稿 $0.096），转正片按正片全价另计；关闭音频不降价，续写实际时长偏短时按实际退还差额',
  },
})

export default apimartFlux3VideoModel
