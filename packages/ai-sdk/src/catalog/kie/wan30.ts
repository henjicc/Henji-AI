import type { JsonObject, JsonValue } from '../../types/runtime'
import type { ModelRuntimeDefinition } from '../../types/model'
import { resolveKieImageSources, resolveKieVideoSources } from './mediaSources'

/** Wan 3.0 与 Wan 3.0 Prime 请求字段完全相同，只有模型 ID 与每秒单价不同。 */
export interface Wan30Variant {
  idPrefix: string
  model: string
  name: string
  /** 每秒美元价，按输出分辨率。 */
  rates: Record<string, number>
}

const RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']
const RESOLUTIONS = ['480p', '720p', '1080p']

function sources(value: JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

export function wan30Definition(variant: Wan30Variant): Omit<ModelRuntimeDefinition, 'meta'> {
  const p = variant.idPrefix
  const read = (params: JsonObject, key: string): JsonValue => params[`${p}${key}`]
  const resolution = (params: JsonObject) => {
    const value = String(read(params, 'Resolution') ?? '720p')
    return RESOLUTIONS.includes(value) ? value : '720p'
  }
  const seconds = (params: JsonObject) => Math.min(30, Math.max(2, Number(read(params, 'Duration') ?? 5) || 5))
  return {
    inputLimits: {
      images: { max: 2 },
      videos: { max: 0 },
      audios: { max: 0 },
      rules: [{ when: `${p}Mode === "reference-to-video"`, images: { max: 10 }, videos: { max: 5 }, audios: { max: 5 } }],
    },
    params: [
      { id: `${p}Mode`, type: 'dropdown', order: 1, default: 'text-image-to-video', options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }] },
      { id: `${p}AspectRatio`, type: 'dropdown', order: 2, default: 'adaptive', options: RATIOS.map(value => ({ value })) },
      { id: `${p}Resolution`, type: 'dropdown', order: 3, default: '720p', options: RESOLUTIONS.map(value => ({ value })) },
      { id: `${p}Duration`, type: 'dropdown', order: 4, default: '5', options: Array.from({ length: 29 }, (_, index) => ({ value: String(index + 2) })) },
      { id: `${p}Audio`, type: 'switch', order: 5, default: true },
    ],
    endpoints: '/api/v1/jobs/createTask',
    request: {
      builder: (params) => {
        const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
        if (prompt.length > 20000) throw new Error(`${variant.name} 提示词最多 20000 字符`)
        const images = resolveKieImageSources(params)
        const rawRatio = String(read(params, 'AspectRatio') ?? 'adaptive')
        const input: JsonObject = {
          resolution: resolution(params).toUpperCase(),
          aspect_ratio: RATIOS.includes(rawRatio) ? rawRatio : 'adaptive',
          duration: seconds(params),
          audio: read(params, 'Audio') !== false,
        }
        if (prompt) input.prompt = prompt
        if (read(params, 'Mode') === 'reference-to-video') {
          const videos = resolveKieVideoSources(params)
          const audios = sources(params.uploadedAudioFilePaths).length ? sources(params.uploadedAudioFilePaths) : sources(params.audios)
          if (images.length > 10 || videos.length > 5 || audios.length > 5) throw new Error(`${variant.name} 最多 10 张参考图、5 段参考视频、5 段参考音频`)
          if (images.length) input.reference_image_urls = images
          if (videos.length) input.reference_video_urls = videos
          if (audios.length) input.reference_audio_urls = audios
          if (!prompt && !images.length && !videos.length && !audios.length) throw new Error(`${variant.name} 需要提示词或参考素材`)
        } else {
          if (images.length > 2) throw new Error(`${variant.name} 首尾帧最多 2 张图片`)
          if (!prompt && !images.length) throw new Error(`${variant.name} 文生视频需要提示词`)
          if (images[0]) input.first_frame_url = images[0]
          if (images[1]) input.last_frame_url = images[1]
        }
        return { model: variant.model, input }
      },
    },
    pricing: {
      currency: '$',
      calculator: params => (variant.rates[resolution(params)] ?? variant.rates['720p']) * seconds(params),
      description: RESOLUTIONS.map(res => `${res} $${variant.rates[res]}/秒`).join('，'),
    },
  }
}
