/** 火山方舟官方 Seedream 单图生成/编辑 + 图层拆分模型族（5.0 Pro、5.0 Flash、5.5）的运行时契约 */

import { defineModel } from '../defineModel'
import type { JsonObject } from '../../types/runtime'
import { parseSeedreamLayerStack } from '../../structured-output'
import { countUploadedImages, resolveUploadedImageSources } from '../shared/mediaPresence'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const
const RESOLUTIONS = ['1K', '1.5K', '2K'] as const
const LAYER_SIZES = ['auto', ...RESOLUTIONS] as const
// 图层结果契约只认底图加 16 层；5.5 不传上限时默认最多返回 30 张，超出会让整份结果作废。
const LAYER_MAX_IMAGES = 17

/**
 * pro / flash：Seedream 5.0；背景只有不透明与透明两档，默认不透明。
 * 5.5：背景多一档 auto 且为官方默认；图层拆分需显式限制层数；按单张输出像素分档计价。
 */
type SeedreamEdition = 'pro' | 'flash' | '5.5'

interface SeedreamConfig {
  id: string
  canonicalModelId: string
  apiModel: string
  paramPrefix: string
  aliases: string[]
  edition: SeedreamEdition
}

const SERIES_RANK: Record<SeedreamEdition, number> = { pro: 5.1, flash: 5.1, '5.5': 5.5 }
const DISPLAY_NAME: Record<SeedreamEdition, string> = { pro: 'Seedream 5.0 Pro', flash: 'Seedream 5.0 Flash', '5.5': 'Seedream 5.5' }

export function createSeedreamModel(config: SeedreamConfig) {
const key = (name: string): string => config.paramPrefix + name
const isLayerMode = (params: JsonObject): boolean => params[key('Mode')] === 'layer-decomposition'
const backgrounds = config.edition === '5.5' ? ['auto', 'transparent', 'opaque'] : ['opaque', 'transparent']

/** 智能比例取首图最接近的支持比例，没有图时用 1:1；再按档位面积换成 16 对齐的宽高。 */
const outputSize = (params: JsonObject): { width: number, height: number } => {
  const ratios: readonly string[] = ASPECT_RATIOS
  const raw = String(params[key('AspectRatio')] || 'smart')
  const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1
  let aspectRatio = ratios.includes(raw) ? raw : '1:1'
  if (raw === 'smart' || raw === 'auto') {
    let difference = Number.POSITIVE_INFINITY
    for (const candidate of ratios) {
      const pair = candidate.split(':').map(Number)
      const next = Math.abs(pair[0] / pair[1] - hint)
      if (next < difference) { difference = next; aspectRatio = candidate }
    }
  }
  const pair = aspectRatio.split(':').map(Number)
  const ratio = pair[0] / pair[1]
  const resolution = String(params[key('Resolution')] || '2K')
  const base = resolution === '2K' ? 2048 : (resolution === '1K' ? 1024 : 1536)
  return {
    width: Math.round(Math.sqrt(base * base * ratio) / 16) * 16,
    height: Math.round(Math.sqrt(base * base / ratio) / 16) * 16
  }
}

return defineModel({
  meta: {
    id: config.id, canonicalModelId: config.canonicalModelId, seriesId: 'seedream', seriesRank: SERIES_RANK[config.edition],
    provider: 'volcengine', type: 'image',
    tags: ['text-to-image', 'image-to-image', 'layer-decomposition', 'transparent-background'],
    aliases: config.aliases
  },
  inputLimits: {
    images: { max: 10 },
    videos: { max: 0 },
    rules: [
      { when: `${key('Mode')} === "layer-decomposition"`, images: { min: 1, max: 1 } }
    ]
  },
  requirements: [
    {
      id: `${config.id}-layer-single-image`,
      when: `${key('Mode')} === "layer-decomposition"`,
      require: { images: { exact: 1 } },
      message: {
        title: '需要一张图片',
        message: '图层拆分模式必须且只能输入 1 张图片。',
        type: 'warning'
      }
    }
  ],
  params: [
    {
      id: key('Mode'), type: 'dropdown', order: 1,
      transferKey: 'layer-decomposition-mode',
      default: 'generate',
      options: [
        { value: 'generate' },
        { value: 'layer-decomposition' }
      ]
    },
    {
      id: key('AspectRatio'), type: 'dropdown', order: 2,
      default: 'smart',
      visible: { condition: `${key('Mode')} !== "layer-decomposition"` },
      options: [{ value: 'smart' }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio }))]
    },
    {
      id: key('Resolution'), type: 'dropdown', order: 3,
      default: '2K',
      visible: { condition: `${key('Mode')} !== "layer-decomposition"` },
      options: RESOLUTIONS.map((value) => ({ value }))
    },
    {
      id: key('LayerSize'), type: 'dropdown', order: 4,
      transferKey: 'layer-output-size',
      default: 'auto',
      visible: { condition: `${key('Mode')} === "layer-decomposition"` },
      options: LAYER_SIZES.map((value) => ({ value }))
    },
    {
      id: key('Background'), type: 'dropdown', order: 5,
      default: backgrounds[0],
      visible: { condition: `${key('Mode')} !== "layer-decomposition"` },
      options: backgrounds.map((value) => ({ value }))
    }
  ],
  endpoints: '/api/v3/images/generations',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params)
      if (images.length > 10) throw new Error(`${DISPLAY_NAME[config.edition]} 最多接受 10 张图片`)
      const prompt = typeof params.prompt === 'string' ? params.prompt : ''
      if (isLayerMode(params)) {
        if (images.length !== 1) throw new Error(`${DISPLAY_NAME[config.edition]} 图层拆分模式必须且只能输入 1 张图片`)
        const rawLayerSize = String(params[key('LayerSize')] || 'auto')
        const body: JsonObject = {
          model: config.apiModel,
          prompt,
          image: images[0],
          layer_decomposition: true,
          size: (LAYER_SIZES as readonly string[]).includes(rawLayerSize) ? rawLayerSize : 'auto',
          response_format: 'url',
          watermark: false
        }
        if (config.edition === '5.5') body.layer_decomposition_options = { max_images: LAYER_MAX_IMAGES }
        return body
      }
      const { width, height } = outputSize(params)
      const rawBackground = String(params[key('Background')] || '')
      const body: JsonObject = {
        model: config.apiModel,
        prompt,
        size: `${width}x${height}`,
        background: backgrounds.includes(rawBackground) ? rawBackground : backgrounds[0],
        response_format: 'url', watermark: false
      }
      if (images.length > 0) body.image = images
      return body
    }
  },
  response: {
    structuredOutput: ({ metadata, params }) => isLayerMode(params)
      ? parseSeedreamLayerStack('volcengine', metadata)
      : undefined
  },
  pricing: {
    currency: '¥',
    calculator: (params) => {
      if (isLayerMode(params)) {
        // 输出层数及每层实际像素档位都由模型结果决定，提交前不能给出可靠总价。
        return Number.NaN
      }
      const inputs = countUploadedImages(params)
      if (config.edition === 'flash') return 0.12
      if (config.edition === '5.5') {
        // 方舟定价页按单张输出总像素分档：≤ 261 万像素 ¥0.13，261 万–462 万 ¥0.23；输入图每张 ¥0.05，无首张免费。
        const { width, height } = outputSize(params)
        return (width * height <= 2_610_000 ? 0.13 : 0.23) + inputs * 0.05
      }
      const output = params[key('Resolution')] === '1K' || params[key('Resolution')] === '1.5K' ? 0.3 : 0.6
      return output + Math.max(0, inputs - 1) * 0.02
    },
    description: {
      flash: '输入图片免费；输出 ¥0.12/张，图层拆分按实际输出计费，提交前总价暂不可估算',
      pro: '生成/编辑：1K/1.5K ¥0.30、2K ¥0.60/张，第 2 张起输入图 +¥0.02/张；图层拆分按实际输出图层与像素档位计费，提交前总价暂不可估算（单层 1K/1.5K ¥0.15、2K/自动 ¥0.30）',
      // 官方未单列 5.5 的图层拆分单价，只说每层按实际像素档位计费；这里按同一张输出价表推断。
      '5.5': '生成/编辑：单张输出 ≤261 万像素（1K/1.5K）¥0.13、以上（2K）¥0.23，输入图 ¥0.05/张；图层拆分按底图与各层实际像素档位逐张计费（推断同为 ¥0.13/¥0.23）另加输入图 ¥0.05，层数由模型决定，提交前总价暂不可估算'
    }[config.edition]
  }
})

}
