/** 火山方舟官方 Seedance 2.5 / 2.0 系列视频生成模型的共用运行时契约。 */

import { defineModel } from '../defineModel'
import { resolveUploadedImageSources } from '../shared/mediaPresence'
import type { RuntimeParamDef } from '../../types/model'
import type { JsonObject, JsonValue } from '../../types/runtime'

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const

/** 官方「不同宽高比对应的宽高像素值」表；2.5 与 2.0 系列在 480p 档取值不同。 */
const PIXELS: Record<'2.5' | '2.0', Record<string, Record<string, [number, number]>>> = {
  '2.5': {
    '480p': { '16:9': [854, 480], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [480, 854], '21:9': [992, 432] },
    '720p': { '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630] },
    '1080p': { '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946] },
  },
  '2.0': {
    '480p': { '16:9': [864, 496], '4:3': [752, 560], '1:1': [640, 640], '3:4': [560, 752], '9:16': [496, 864], '21:9': [992, 432] },
    '720p': { '16:9': [1280, 720], '4:3': [1112, 834], '1:1': [960, 960], '3:4': [834, 1112], '9:16': [720, 1280], '21:9': [1470, 630] },
    '1080p': { '16:9': [1920, 1080], '4:3': [1664, 1248], '1:1': [1440, 1440], '3:4': [1248, 1664], '9:16': [1080, 1920], '21:9': [2206, 946] },
    '4k': { '16:9': [3840, 2160], '4:3': [3326, 2494], '1:1': [2880, 2880], '3:4': [2494, 3326], '9:16': [2160, 3840], '21:9': [4398, 1886] },
  },
}

export interface VolcengineSeedanceConfig {
  id: string
  canonicalModelId: string
  seriesRank: number
  apiModel: string
  /** 参数 ID 前缀，例如 `volcengineSeedance25`。 */
  paramPrefix: string
  generation: '2.5' | '2.0'
  resolutions: string[]
  /** 输入不含视频时的在线推理 token 单价（元/百万 token），按输出分辨率。 */
  tokenPrices: Record<string, number>
  priceDescription: string
}

function audioSources(params: JsonObject): string[] {
  const pick = (value: JsonValue): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const uploaded = pick(params.uploadedAudioFilePaths)
  return uploaded.length > 0 ? uploaded : pick(params.audios)
}

export function createVolcengineSeedanceModel(config: VolcengineSeedanceConfig) {
  const key = (name: string): string => config.paramPrefix + name
  const is25 = config.generation === '2.5'
  const maxDuration = is25 ? 30 : 15
  const maxReferenceImages = is25 ? 30 : 9
  const maxReferenceAudios = is25 ? 10 : 3

  const resolution = (params: JsonObject): string => {
    const value = String(params[key('Resolution')] ?? '720p')
    return config.resolutions.includes(value) ? value : '720p'
  }
  const autoDuration = (params: JsonObject): boolean => is25 && params[key('AutoDuration')] === true
  const duration = (params: JsonObject): number =>
    Math.min(maxDuration, Math.max(4, Math.round(Number(params[key('Duration')] || 5))))

  const params: RuntimeParamDef[] = [
    {
      id: key('Mode'), type: 'dropdown', order: 1,
      default: 'reference-to-video',
      options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }],
    },
    {
      id: key('AspectRatio'), type: 'dropdown', order: 2,
      default: 'smart',
      options: [{ value: 'smart' }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((value) => ({ value }))],
    },
    {
      id: key('Resolution'), type: 'dropdown', order: 3,
      default: '720p',
      options: config.resolutions.map((value) => ({ value })),
    },
    {
      id: key('Duration'), type: 'number', order: 4,
      default: 5, min: 4, max: maxDuration, step: 1,
    },
    ...(is25 ? [{ id: key('AutoDuration'), type: 'switch' as const, order: 5, default: false }] : []),
    { id: key('GenerateAudio'), type: 'switch', order: 6, default: true },
    { id: key('ReturnLastFrame'), type: 'switch', order: 7, default: false },
    { id: key('WebSearch'), type: 'switch', order: 8, default: false },
  ]

  return defineModel({
    meta: {
      id: config.id, canonicalModelId: config.canonicalModelId, seriesId: 'seedance', seriesRank: config.seriesRank,
      provider: 'volcengine', type: 'video',
      tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode'],
      polling: { interval: 5000, maxAttempts: 400, expectedAttempts: 60 },
    },
    // 方舟参考视频只收公网 URL 或素材 ID，方舟没有可供视频生成使用的官方上传，故不开放参考视频。
    inputLimits: {
      images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
      rules: [{
        when: `${key('Mode')} === "reference-to-video"`,
        images: { max: maxReferenceImages }, videos: { max: 0 }, audios: { max: maxReferenceAudios },
      }],
    },
    params,
    endpoints: '/api/v3/contents/generations/tasks',
    request: {
      builder: (input) => {
        const images = resolveUploadedImageSources(input)
        const audios = audioSources(input)
        const reference = input[key('Mode')] !== 'text-image-to-video'
        const rawRatio = String(input[key('AspectRatio')] || 'smart')
        const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
        const content: JsonValue[] = []
        if (prompt) content.push({ type: 'text', text: prompt })

        const body: JsonObject = {
          model: config.apiModel,
          content,
          resolution: resolution(input),
          ratio: (RATIOS as readonly string[]).includes(rawRatio) ? rawRatio : 'adaptive',
          duration: autoDuration(input) ? -1 : duration(input),
          generate_audio: input[key('GenerateAudio')] !== false,
          return_last_frame: input[key('ReturnLastFrame')] === true,
          watermark: false,
        }
        if (input[key('WebSearch')] === true) body.tools = [{ type: 'web_search' }]

        if (reference) {
          if (images.length + audios.length === 0) throw new Error(`Seedance ${config.generation} 参考生视频至少需要一张参考图或一段参考音频`)
          if (!is25 && images.length === 0) throw new Error('Seedance 2.0 的参考音频必须与参考图片一起使用')
          // 不开放参考视频，参考任务只可能是参考生视频，显式声明以便提交时就校验限制。
          if (is25) body.omni_reference_task_type = 'reference'
          for (const url of images.slice(0, maxReferenceImages)) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
          for (const url of audios.slice(0, maxReferenceAudios)) content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
          return body
        }

        if (!prompt && images.length === 0) throw new Error(`Seedance ${config.generation} 文生视频需要填写提示词`)
        images.slice(0, 2).forEach((url, index) => {
          content.push({ type: 'image_url', image_url: { url }, role: index === 0 ? 'first_frame' : 'last_frame' })
        })
        // 2.5 首帧、首尾帧任务只接受 adaptive，输出比例跟随首帧。
        if (is25 && images.length > 0) body.ratio = 'adaptive'
        return body
      },
    },
    pricing: {
      currency: '¥',
      calculator: (input) => {
        const res = resolution(input)
        const rawRatio = String(input[key('AspectRatio')] || 'smart')
        const table = PIXELS[config.generation][res] ?? PIXELS[config.generation]['720p']
        const [width, height] = table[rawRatio] ?? table['16:9']
        const seconds = autoDuration(input) ? maxDuration : duration(input)
        // 官方 token 用量估算：(输入视频时长 + 输出时长) × 宽 × 高 × 24fps / 1024；本入口无输入视频。
        const tokens = seconds * width * height * 24 / 1024
        return tokens * (config.tokenPrices[res] ?? config.tokenPrices['720p']) / 1_000_000
      },
      description: config.priceDescription,
    },
  })
}
