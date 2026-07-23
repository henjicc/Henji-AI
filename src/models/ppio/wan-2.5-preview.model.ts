/**
 * Wan 2.5 Preview 视频生成模型
 *
 * 万象 2.5 预览版本，支持文生视频和图生视频
 */

import { defineModel, sharedFieldText } from '@/core'
import { resolvePpioImageSources } from './mediaSources'

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

function resolveBoolean(value: DynamicValue, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function resolveDuration(value: DynamicValue): 5 | 10 {
  return value === 10 ? 10 : 5
}

function resolveSupportedValue(
  preferred: DynamicValue,
  legacy: DynamicValue,
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
        i18nScope: 'models.defs.ppio-wan-2.5-preview',
    name: { key: 'meta.name', fallback: 'Wan 2.5 Preview' },
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
      name: sharedFieldText('duration'),
      default: 5,
      options: [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' }
      ],
      apiField: 'duration'
    },
    // 2. 尺寸（文生视频）
    {
      id: 'ppioWan25Size',
      type: 'dropdown',
      order: 2,
      name: sharedFieldText('size'),
      default: DEFAULT_WAN25_SIZE,
      options: [
        { value: '832*480', label: '832×480' },
        { value: '480*832', label: '480×832' },
        { value: '624*624', label: '624×624' },
        { value: '1280*720', label: '1280×720' },
        { value: '720*1280', label: '720×1280' },
        { value: '960*960', label: '960×960' },
        { value: '1088*832', label: '1088×832' },
        { value: '832*1088', label: '832×1088' },
        { value: '1920*1080', label: '1920×1080' },
        { value: '1080*1920', label: '1080×1920' },
        { value: '1440*1440', label: '1440×1440' },
        { value: '1632*1248', label: '1632×1248' },
        { value: '1248*1632', label: '1248×1632' }
      ],
      apiField: 'size'
    },
    // 3. 分辨率（图生视频）
    {
      id: 'ppioWan25Resolution',
      type: 'dropdown',
      order: 3,
      name: sharedFieldText('resolution'),
      default: DEFAULT_WAN25_RESOLUTION,
      options: [
        { value: '480P', label: '480P' },
        { value: '720P', label: '720P' },
        { value: '1080P', label: '1080P' }
      ],
      apiField: 'resolution'
    },
    // 4. 智能改写
    {
      id: 'ppioWan25PromptExtend',
      type: 'switch',
      order: 4,
      name: sharedFieldText('promptRewrite'),
      default: true,
      apiField: 'prompt_extend'
    },
    // 5. 生成音频
    {
      id: 'ppioWan25Audio',
      type: 'switch',
      order: 5,
      name: sharedFieldText('generateAudio'),
      default: true,
      apiField: 'audio'
    }
  ],
  linkages: [
    // Hide size parameter when image is uploaded (use resolution instead)
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioWan25Size'],
      condition: (images) => (images?.length || 0) > 0
    },
    // Hide resolution parameter when no image (use size instead)
    {
      trigger: 'uploadedImages',
      effect: 'hide',
      targets: ['ppioWan25Resolution'],
      condition: (images) => (images?.length || 0) === 0
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
        return {
          input: {
            prompt,
            img_url: images[0],
            ...(audioUrl ? { audio_url: audioUrl } : {})
          },
          parameters: {
            resolution,
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
      } else {
        // Text-to-video
        return {
          input: {
            prompt,
            ...(audioUrl ? { audio_url: audioUrl } : {})
          },
          parameters: {
            size,
            duration,
            prompt_extend,
            watermark: false,
            audio
          }
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      const duration = params.ppioWan25VideoDuration || 5
      const basePrice = 0.3
      const durationMultiplier = duration / 5
      return basePrice * durationMultiplier
    },
    description: '基础价格 ¥0.3/5秒'
  }
})

export default wan25PreviewModel;
