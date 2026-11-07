import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { resolveUploadedImageSources } from '../shared/mediaPresence'

const RATIOS = ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4']
const RESOLUTIONS = ['480p', '720p', '1080p']
// 每秒积分；基础充值档 1 积分 = ¥0.0001。
const CREDITS_PER_SECOND: Record<string, number> = { '480p': 3300, '720p': 6600, '1080p': 13200 }

const isReference = (params: JsonObject) => params.grsaiWan30Mode === 'reference-to-video'
const resolutionOf = (params: JsonObject) => RESOLUTIONS.includes(String(params.grsaiWan30Resolution)) ? String(params.grsaiWan30Resolution) : '720p'
// 官方文档写 2–30 秒，接口实际拒绝 2 秒（“duration must be greater than 2 seconds”，2026-11-08 实调），最短 3 秒。
// 保存过的 2 秒旧值会在提交前的参数检查被拦下（它本来就会被平台拒绝），这里的下限只兜底直接调用构建器的消费方。
const secondsOf = (params: JsonObject) => Math.min(30, Math.max(3, Number(params.grsaiWan30Duration ?? 5) || 5))

function sources(value: JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function nearestRatio(params: JsonObject): string {
  const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
    ? params.__firstImageRatio : 16 / 9
  return RATIOS.reduce((best, next) => {
    const value = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
    return Math.abs(value(next) - hint) < Math.abs(value(best) - hint) ? next : best
  }, '16:9')
}

export const grsaiWan30Model = defineModel({
  meta: {
    id: 'grsai-wan-3.0', canonicalModelId: 'wan-3.0', seriesId: 'wan', seriesRank: 3,
    provider: 'grsai', type: 'video',
    tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
    polling: { interval: 5000, maxAttempts: 300, expectedAttempts: 60 },
  },
  // 参考视频官方标注“正在兼容中”，暂不开放。
  inputLimits: {
    images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
    rules: [{ when: 'grsaiWan30Mode === "reference-to-video"', images: { max: 10 }, audios: { max: 5 } }],
  },
  params: [
    { id: 'grsaiWan30Mode', type: 'dropdown', order: 1, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
    { id: 'grsaiWan30AspectRatio', type: 'dropdown', order: 2, default: 'smart', options: ['smart', ...RATIOS].map(value => ({ value })) },
    { id: 'grsaiWan30Resolution', type: 'dropdown', order: 3, default: '720p', options: RESOLUTIONS.map(value => ({ value })) },
    { id: 'grsaiWan30Duration', type: 'dropdown', order: 4, default: '5', options: Array.from({ length: 28 }, (_, index) => ({ value: String(index + 3) })) },
  ],
  endpoints: '/v1/api/generate',
  request: { builder: params => {
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('请输入 Wan 3.0 提示词')
    const images = resolveUploadedImageSources(params)
    const rawRatio = String(params.grsaiWan30AspectRatio ?? 'smart')
    const body: JsonObject = {
      model: 'wan-3.0', prompt: params.prompt,
      aspectRatio: RATIOS.includes(rawRatio) ? rawRatio : nearestRatio(params),
      resolution: resolutionOf(params), duration: secondsOf(params),
    }
    // 首尾帧与参考图、参考音频互斥，按模式只发一组。
    if (isReference(params)) {
      const audios = sources(params.uploadedAudioFilePaths).length ? sources(params.uploadedAudioFilePaths) : sources(params.audios)
      if (images.length > 10 || audios.length > 5) throw new Error('Wan 3.0 最多 10 张参考图、5 段参考音频')
      if (images.length) body.images = images
      if (audios.length) body.audios = audios
    } else {
      if (images.length > 2) throw new Error('Wan 3.0 首尾帧最多 2 张图片')
      if (images[0]) body.firstFrame = images[0]
      if (images[1]) body.lastFrame = images[1]
    }
    return body
  } },
  pricing: {
    currency: '¥',
    calculator: params => CREDITS_PER_SECOND[resolutionOf(params)] * 0.0001 * secondsOf(params),
    description: '按秒计费：480p/720p/1080p 每秒 3300/6600/13200 积分；基础充值档 ¥0.33/¥0.66/¥1.32 每秒，高额充值档约半价',
  },
})
export default grsaiWan30Model
