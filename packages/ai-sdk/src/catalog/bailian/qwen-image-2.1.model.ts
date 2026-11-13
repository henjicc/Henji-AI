/** 阿里云百炼官方 Qwen Image 2.1（Pro / Turbo）图片生成与编辑模型（运行时契约） */

// 字段与价格来源：docs/model-adaptation/Qwen-Image-2.1/Qwen-Image-2.1_百炼.md（百炼模型页与 API 参考，2026-11-14 读取）
import { defineModel } from '../defineModel'
import type { JsonObject, JsonValue } from '../../types/runtime'
import { resolveUploadedImageSources } from '../shared/mediaPresence'

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'] as const
// 官方模型页只按生成张数计价，没有输入图费用，也不按分辨率分档
const PRICE_PER_IMAGE: Record<string, number> = { pro: 0.25, turbo: 0.1 }

const variantOf = (params: JsonObject): 'pro' | 'turbo' => params.bailianQwenImage21Variant === 'turbo' ? 'turbo' : 'pro'
const countOf = (params: JsonObject): number => Math.min(6, Math.max(1, Math.round(Number(params.bailianQwenImage21Count || 1))))

export const bailianQwenImage21Model = defineModel({
  meta: {
    id: 'bailian-qwen-image-2.1', canonicalModelId: 'qwen-image-2.1', seriesId: 'qwen-image', seriesRank: 2.1,
    provider: 'bailian', type: 'image',
    // 2.1 按提示词自动决定是否输出带透明通道的 PNG，官方把主体提取与透明图层编辑列为模型能力
    tags: ['text-to-image', 'image-to-image'],
    aliases: ['bailian-qwen-image-2.1-pro'],
    aliasParamDefaults: {
      'bailian-qwen-image-2.1-pro': { bailianQwenImage21Variant: 'pro' }
    },
    aliasParamMappings: {
      'bailian-qwen-image-2.1-pro': {
        bailianQwenImage21ProAspectRatio: 'bailianQwenImage21AspectRatio',
        bailianQwenImage21ProResolution: 'bailianQwenImage21Resolution',
        bailianQwenImage21ProCount: 'bailianQwenImage21Count'
      }
    }
  },
  inputLimits: { images: { max: 10 }, videos: { max: 0 } },
  params: [
    {
      id: 'bailianQwenImage21Variant', type: 'dropdown', order: 1,
      default: 'pro',
      options: [
        { value: 'pro' },
        { value: 'turbo' }
      ]
    },
    {
      id: 'bailianQwenImage21AspectRatio', type: 'dropdown', order: 2,
      default: 'smart',
      options: [{ value: 'smart' }, ...ASPECT_RATIOS.map((ratio) => ({ value: ratio }))]
    },
    {
      id: 'bailianQwenImage21Resolution', type: 'dropdown', order: 3,
      default: '1K',
      options: ['1K', '2K'].map((value) => ({ value }))
    },
    {
      id: 'bailianQwenImage21Count', type: 'number', order: 4,
      default: 1, min: 1, max: 6, step: 1
    }
  ],
  endpoints: '/api/v1/services/aigc/multimodal-generation/generation',
  request: {
    builder: (params) => {
      const images = resolveUploadedImageSources(params).slice(0, 10)
      const ratios: readonly string[] = ASPECT_RATIOS
      const raw = String(params.bailianQwenImage21AspectRatio || 'smart')
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
      const base = params.bailianQwenImage21Resolution === '2K' ? 2048 : 1024
      // 官方要求总像素不超过 base²：向下取到 8 的倍数，四舍五入会让 4:3、3:2 等比例越界被拒。
      const width = Math.max(384, Math.floor(Math.sqrt(base * base * ratio) / 8) * 8)
      const height = Math.max(384, Math.floor(Math.sqrt(base * base / ratio) / 8) * 8)
      const content: JsonValue[] = images.map((image) => ({ image }))
      content.push({ text: typeof params.prompt === 'string' ? params.prompt : '' })
      return {
        model: `qwen-image-2.1-${variantOf(params)}`,
        input: { messages: [{ role: 'user', content }] },
        parameters: {
          prompt_extend: true, prompt_extend_mode: 'direct', enable_thinking: false,
          n: countOf(params), size: `${width}*${height}`, watermark: false
        }
      }
    }
  },
  pricing: {
    currency: '¥',
    calculator: (params) => PRICE_PER_IMAGE[variantOf(params)] * countOf(params),
    description: 'Pro ¥0.25/张、Turbo ¥0.10/张（1K/2K 同价），输入图不计费'
  }
})

export default bailianQwenImage21Model
