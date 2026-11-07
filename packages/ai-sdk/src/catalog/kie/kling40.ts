import type { JsonObject, JsonValue } from '../../types/runtime'
import type { ModelRuntimeDefinition } from '../../types/model'
import { hasUploadedImage, hasUploadedVideo, resolveKieImageSources, resolveKieVideoSources } from './mediaSources'

/** Kling 4.0 标准版与 Flash 共用 keyframe-to-video / reference-to-video 两个端点，差别只在档位与上限。 */
export interface Kling40Variant {
  idPrefix: string
  modelPrefix: string
  name: string
  maxDuration: number
  /** Flash 只接受首帧，不支持中间帧与尾帧。 */
  firstFrameOnly: boolean
  resolutions: string[]
  /** 每秒美元价：keyframe 与无视频参考同价，带参考视频另一档。 */
  rates: Record<string, { base: number; withVideo: number }>
}

const RATIOS = ['16:9', '9:16', '1:1', '21:9']
const MODES = ['text-image-to-video', 'reference-to-video']

function param(params: JsonObject, prefix: string, key: string): JsonValue {
  return params[`${prefix}${key}`]
}

function nearestRatio(params: JsonObject): string {
  const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
    ? params.__firstImageRatio : 16 / 9
  return RATIOS.reduce((best, next) => {
    const value = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h }
    return Math.abs(value(next) - hint) < Math.abs(value(best) - hint) ? next : best
  }, '16:9')
}

export function kling40Definition(variant: Kling40Variant): Omit<ModelRuntimeDefinition, 'meta'> {
  const p = variant.idPrefix
  const isReference = (params: JsonObject) => param(params, p, 'Mode') === 'reference-to-video'
  const duration = (params: JsonObject) => {
    const value = Number(param(params, p, 'Duration') ?? 5)
    if (!Number.isInteger(value) || value < 3 || value > variant.maxDuration) throw new Error(`${variant.name} 时长须为 3–${variant.maxDuration} 秒`)
    return value
  }
  const resolution = (params: JsonObject) => {
    const value = String(param(params, p, 'Resolution') ?? variant.resolutions[0])
    return variant.resolutions.includes(value) ? value : variant.resolutions[0]
  }
  return {
    inputLimits: {
      images: { max: variant.firstFrameOnly ? 1 : 10 },
      videos: { max: 0 },
      rules: [{ when: `${p}Mode === "reference-to-video"`, images: { max: 10 }, videos: { max: 5 } }],
    },
    params: [
      { id: `${p}Mode`, type: 'dropdown', order: 1, default: 'text-image-to-video', options: MODES.map(value => ({ value })) },
      // 关键帧模式下有图时画面比例跟随首帧，请求不带比例，界面也不显示。
      { id: `${p}AspectRatio`, type: 'dropdown', order: 2, default: 'smart', options: ['smart', ...RATIOS].map(value => ({ value })), visible: { condition: params => isReference(params) || !hasUploadedImage(params) } },
      ...(variant.resolutions.length > 1
        ? [{ id: `${p}Resolution`, type: 'dropdown' as const, order: 3, default: variant.resolutions[0], options: variant.resolutions.map(value => ({ value })) }]
        : []),
      {
        id: `${p}Duration`, type: 'dropdown', order: 4, default: '5',
        options: Array.from({ length: variant.maxDuration - 2 }, (_, index) => ({ value: String(index + 3) })),
      },
      { id: `${p}KeepOriginalSound`, type: 'switch', order: 5, default: false, visible: { condition: params => isReference(params) && hasUploadedVideo(params) } },
    ],
    endpoints: '/api/v1/jobs/createTask',
    request: {
      builder: (params) => {
        const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
        if (!prompt) throw new Error(`${variant.name} 的提示词不能为空`)
        if (prompt.length > 8000) throw new Error(`${variant.name} 提示词最多 8000 字符`)
        const seconds = duration(params)
        const images = resolveKieImageSources(params)
        const rawRatio = String(param(params, p, 'AspectRatio') ?? 'smart')
        const input: JsonObject = { prompt, duration: seconds, resolution: resolution(params) }
        if (isReference(params)) {
          const videos = resolveKieVideoSources(params)
          if (images.length > 10) throw new Error(`${variant.name} 最多 10 张参考图`)
          if (videos.length > 5) throw new Error(`${variant.name} 最多 5 段参考视频`)
          if (images.length) input.image_urls = images
          if (videos.length) {
            input.video_urls = videos
            input.keep_original_sound = param(params, p, 'KeepOriginalSound') === true
          }
          input.aspect_ratio = RATIOS.includes(rawRatio) ? rawRatio : (images.length || videos.length ? 'auto' : '16:9')
          return { model: `${variant.modelPrefix}reference-to-video`, input }
        }
        // 有帧时画面比例跟随首帧，比例只在纯文生视频时生效。
        const maxFrames = variant.firstFrameOnly ? 1 : Math.min(seconds + 1, 10)
        if (images.length > maxFrames) throw new Error(`${variant.name} ${seconds} 秒最多使用 ${maxFrames} 张关键帧`)
        if (images.length === 0) input.aspect_ratio = RATIOS.includes(rawRatio) ? rawRatio : nearestRatio(params)
        if (images[0]) input.first_frame_url = images[0]
        if (images.length > 1) {
          input.last_frame_url = images[images.length - 1]
          if (images.length > 2) input.keyframe_urls = images.slice(1, -1)
        }
        return { model: `${variant.modelPrefix}keyframe-to-video`, input }
      },
    },
    pricing: {
      currency: '$',
      calculator: (params) => {
        const rate = variant.rates[resolution(params)]
        const withVideo = isReference(params) && hasUploadedVideo(params)
        const seconds = Math.min(variant.maxDuration, Math.max(3, Number(param(params, p, 'Duration') ?? 5) || 5))
        return (withVideo ? rate.withVideo : rate.base) * seconds
      },
      description: Object.entries(variant.rates)
        .map(([res, rate]) => `${res} $${rate.base}/秒，带参考视频 $${rate.withVideo}/秒`).join('；'),
    },
  }
}
