/**
 * Wan 2.5 Preview 视频生成模型（运行时契约）
 *
 * 万象 2.5 预览版本，支持文生视频和图生视频
 */

import { defineModel } from '../defineModel'
import { hasUploadedImage, resolvePpioImageSources } from './mediaSources'
import type { JsonValue, JsonObject } from '../../types/runtime'

const DEFAULT_WAN25_SIZE = '1280*720'
const DEFAULT_WAN25_RESOLUTION = '720P'
const SUPPORTED_WAN25_SIZES = new Set([
  '832*480',
  '480*832',
  '624*624',
  '1280*720',
  '720*1280',
  '960*960',
  '1088*832',
  '832*1088',
  '1920*1080',
  '1080*1920',
  '1440*1440',
  '1632*1248',
  '1248*1632',
])
const SUPPORTED_WAN25_RESOLUTIONS = new Set(['480P', '720P', '1080P'])

/** t2v 用 size 字符串（如 "1280*720"）标定档位，按面积就近归到 480P/720P/1080P 三档定价。 */
const WAN25_SIZE_TIER: Record<string, '480P' | '720P' | '1080P'> = {
  '832*480': '480P', '480*832': '480P', '624*624': '480P',
  '1280*720': '720P', '720*1280': '720P', '960*960': '720P', '1088*832': '720P', '832*1088': '720P',
  '1920*1080': '1080P', '1080*1920': '1080P', '1440*1440': '1080P', '1632*1248': '1080P', '1248*1632': '1080P',
}

/** ¥/秒；官方 5 秒档 480P ¥1.5、720P ¥3.0、1080P ¥5.0，按时长线性计费。 */
const WAN25_PRICE_PER_SECOND: Record<'480P' | '720P' | '1080P', number> = {
  '480P': 0.3, '720P': 0.6, '1080P': 1.0,
}

function resolveBoolean(value: JsonValue, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function resolveDuration(value: JsonValue): 5 | 10 {
  return value === 10 ? 10 : 5
}

function resolveSupportedValue(
  preferred: JsonValue,
  legacy: JsonValue,
  supportedValues: ReadonlySet<string>,
  fallback: string
): string {
  if (typeof preferred === 'string' && supportedValues.has(preferred)) {
    return preferred
  }
  if (typeof legacy === 'string' && supportedValues.has(legacy)) {
    return legacy
  }
  return fallback
}

export const wan25PreviewModel = defineModel({
  meta: {
    id: 'ppio-wan-2.5-preview',
    canonicalModelId: 'wan-2.5-preview',
    seriesId: 'wan',
    seriesRank: 2.5,
    provider: 'ppio',
    type: 'video',
    tags: ['video', 'text-to-video', 'image-to-video'],
  },
  inputLimits: {
    images: { max: 1 },
    videos: { max: 0 }
  },
  params: [
    // 1. 时长
    {
      id: 'ppioWan25VideoDuration',
      type: 'dropdown',
      order: 1,
      default: 5,
      options: [
        { value: 5 },
        { value: 10 }
      ],
      apiField: 'duration'
    },
    // 2. 尺寸（文生视频）
    {
      id: 'ppioWan25Size',
      type: 'dropdown',
      order: 2,
      default: DEFAULT_WAN25_SIZE,
      options: [
        { value: '832*480' },
        { value: '480*832' },
        { value: '624*624' },
        { value: '1280*720' },
        { value: '720*1280' },
        { value: '960*960' },
        { value: '1088*832' },
        { value: '832*1088' },
        { value: '1920*1080' },
        { value: '1080*1920' },
        { value: '1440*1440' },
        { value: '1632*1248' },
        { value: '1248*1632' }
      ],
      apiField: 'size'
    },
    // 3. 分辨率（图生视频）
    {
      id: 'ppioWan25Resolution',
      type: 'dropdown',
      order: 3,
      default: DEFAULT_WAN25_RESOLUTION,
      options: [
        { value: '480P' },
        { value: '720P' },
        { value: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 4. 智能改写
    {
      id: 'ppioWan25PromptExtend',
      type: 'switch',
      order: 4,
      default: true,
      apiField: 'prompt_extend'
    },
    // 5. 生成音频
    {
      id: 'ppioWan25Audio',
      type: 'switch',
      order: 5,
      default: true,
      apiField: 'audio'
    }
  ],
  endpoints: {
    selector: async (params) => {
      const images = resolvePpioImageSources(params)
      return images.length > 0 ? '/async/wan-2.5-i2v-preview' : '/async/wan-2.5-t2v-preview'
    }
  },
  request: {
    builder: (params) => {
      const images = resolvePpioImageSources(params)
      const duration = resolveDuration(params.ppioWan25VideoDuration ?? params.duration)
      const prompt_extend = resolveBoolean(
        params.ppioWan25PromptExtend ?? params.prompt_extend,
        true
      )
      const audio = resolveBoolean(params.ppioWan25Audio ?? params.audio, true)
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      const audioUrl = params.audio_url
      const resolution = resolveSupportedValue(
        params.ppioWan25Resolution,
        params.resolution,
        SUPPORTED_WAN25_RESOLUTIONS,
        DEFAULT_WAN25_RESOLUTION
      )
      const size = resolveSupportedValue(
        params.ppioWan25Size,
        params.size,
        SUPPORTED_WAN25_SIZES,
        DEFAULT_WAN25_SIZE
      )

      if (images.length > 0) {
        // Image-to-video
        const result: JsonObject = {
          input: {
            prompt,
            img_url: images[0],
            ...(audioUrl ? { audio_url: audioUrl as JsonValue } : {})
          },
          parameters: {
            resolution,
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
        return result
      } else {
        // Text-to-video
        const result: JsonObject = {
          input: {
            prompt,
            ...(audioUrl ? { audio_url: audioUrl as JsonValue } : {})
          },
          parameters: {
            size,
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
        return result
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = Number(params.ppioWan25VideoDuration) || 5
      const tier = hasUploadedImage(params)
        ? (SUPPORTED_WAN25_RESOLUTIONS.has(params.ppioWan25Resolution as string)
          ? params.ppioWan25Resolution as '480P' | '720P' | '1080P'
          : '720P')
        : (WAN25_SIZE_TIER[params.ppioWan25Size as string] ?? '720P')
      return WAN25_PRICE_PER_SECOND[tier] * duration
    },
    description: '480P ¥0.3/秒，720P ¥0.6/秒，1080P ¥1.0/秒，按生成时长计费'
  }
})

export default wan25PreviewModel
