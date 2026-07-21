import { sharedFieldText } from '@/core'
import type { ParamDef } from '@/core/types'

const VIDU_Q2_EDITIONS = ['q2', 'pro', 'pro-fast', 'turbo'] as const
const VIDU_Q2_MODES = [
  'text-image-to-video',
  'reference-to-video',
  'start-end-frame',
  'smart-multiframe'
] as const

export type ViduQ2Edition = (typeof VIDU_Q2_EDITIONS)[number]
export type ViduQ2Mode = (typeof VIDU_Q2_MODES)[number]

export const MODE_SUPPORT_MATRIX: Record<ViduQ2Edition, ViduQ2Mode[]> = {
  q2: ['text-image-to-video', 'reference-to-video'],
  pro: ['text-image-to-video', 'start-end-frame', 'smart-multiframe'],
  'pro-fast': ['text-image-to-video', 'start-end-frame'],
  turbo: ['text-image-to-video', 'start-end-frame', 'smart-multiframe']
}

export const MODE_FALLBACK: Record<ViduQ2Edition, ViduQ2Mode> = {
  q2: 'text-image-to-video',
  pro: 'text-image-to-video',
  'pro-fast': 'text-image-to-video',
  turbo: 'text-image-to-video'
}

export function isViduQ2Edition(value: DynamicValue): value is ViduQ2Edition {
  return typeof value === 'string' && VIDU_Q2_EDITIONS.includes(value as ViduQ2Edition)
}

export function resolveEditionFromParams(params: DynamicValueMap): ViduQ2Edition {
  const proMode = params.ppioViduQ2ProMode === true
  const fastMode = params.ppioViduQ2FastMode === true
  if (proMode && fastMode) {
    return 'pro-fast'
  }
  if (proMode) {
    return 'pro'
  }
  if (fastMode) {
    return 'turbo'
  }

  const preferred = params.ppioViduQ2Edition
  if (isViduQ2Edition(preferred)) {
    return preferred
  }
  const legacy = params.edition
  if (isViduQ2Edition(legacy)) {
    return legacy
  }
  return 'q2'
}

export function resolveModeFromParams(params: DynamicValueMap, edition: ViduQ2Edition): ViduQ2Mode {
  const preferred = params.ppioViduQ2Mode
  const legacy = params.mode
  const mode = typeof preferred === 'string' ? preferred : (typeof legacy === 'string' ? legacy : MODE_FALLBACK[edition])
  const supported = MODE_SUPPORT_MATRIX[edition]
  return supported.includes(mode as ViduQ2Mode) ? (mode as ViduQ2Mode) : MODE_FALLBACK[edition]
}

export const viduQ2Params: ParamDef[] = [
  {
    id: 'ppioViduQ2Mode',
    type: 'dropdown',
    order: 1,
    name: sharedFieldText('mode'),
    default: 'text-image-to-video',
    options: [
      { value: 'text-image-to-video', label: { zh: '文/图生视频', en: 'Text/Image to Video' } },
      { value: 'reference-to-video', label: { zh: '参考生视频', en: 'Reference to Video' } },
      { value: 'start-end-frame', label: { zh: '首尾帧', en: 'Start-End Frame' } },
      { value: 'smart-multiframe', label: { zh: '智能多帧', en: 'Smart Multiframe' } }
    ],
    apiField: 'mode'
  },
  {
    id: 'ppioViduQ2Duration',
    type: 'dropdown',
    order: 2,
    name: sharedFieldText('duration'),
    default: 5,
    options: Array.from({ length: 10 }, (_, index) => {
      const value = index + 1
      return { value, label: `${value}s` }
    }),
    apiField: 'duration'
  },
  {
    id: 'ppioViduQ2MultiframeSegmentDuration',
    type: 'dropdown',
    order: 3,
    name: { zh: '段落时长', en: 'Segment Duration' },
    default: 5,
    options: Array.from({ length: 6 }, (_, index) => {
      const value = index + 2
      return { value, label: `${value}s` }
    }),
    apiField: 'multiframeSegmentDuration'
  },
  {
    id: 'ppioViduQ2Resolution',
    type: 'dropdown',
    order: 4,
    name: sharedFieldText('resolution'),
    default: '720p',
    options: [
      { value: '540p', label: '540P' },
      { value: '720p', label: '720P' },
      { value: '1080p', label: '1080P' }
    ],
    apiField: 'resolution'
  },
  {
    id: 'ppioViduQ2AspectRatio',
    type: 'dropdown',
    order: 5,
    name: sharedFieldText('aspectRatio'),
    default: '16:9',
    options: [
      { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }
    ],
    apiField: 'aspect_ratio'
  },
  {
    id: 'ppioViduQ2Style',
    type: 'dropdown',
    order: 6,
    name: sharedFieldText('style'),
    default: 'general',
    options: [
      { value: 'general', label: { zh: '通用', en: 'General' } },
      { value: 'cinematic', label: { zh: '电影感', en: 'Cinematic' } },
      { value: 'realistic', label: { zh: '写实', en: 'Realistic' } },
      { value: 'anime', label: { zh: '动漫', en: 'Anime' } }
    ],
    apiField: 'style'
  },
  {
    id: 'ppioViduQ2MovementAmplitude',
    type: 'dropdown',
    order: 7,
    name: sharedFieldText('movementAmplitude'),
    default: 'auto',
    options: [
      { value: 'auto', label: { zh: '自动', en: 'Auto' } },
      { value: 'small', label: { zh: '小', en: 'Small' } },
      { value: 'medium', label: { zh: '中', en: 'Medium' } },
      { value: 'high', label: { zh: '大', en: 'High' } }
    ],
      apiField: 'movement_amplitude'
  },
  {
    id: 'ppioViduQ2ProMode',
    type: 'switch',
    order: 8,
    name: { zh: '专业模式', en: 'Pro Mode' },
    default: false
  },
  {
    id: 'ppioViduQ2FastMode',
    type: 'switch',
    order: 9,
    name: sharedFieldText('fastMode'),
    default: false
  },
  {
    id: 'ppioViduQ2Audio',
    type: 'switch',
    order: 10,
    name: sharedFieldText('generateAudio'),
    default: false,
    apiField: 'audio'
  },
  {
    id: 'ppioViduQ2Bgm',
    type: 'switch',
    order: 11,
    name: sharedFieldText('backgroundMusic'),
    default: false,
    apiField: 'bgm'
  }
]
