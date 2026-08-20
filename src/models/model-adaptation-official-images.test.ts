import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core', async () => {
  const [{ defineModel }, modelText] = await Promise.all([
    import('@/core/defineModel'),
    import('@/core/i18n/modelText'),
  ])
  return { defineModel, ...modelText }
})

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { evalFunction } from '../../electron/main/services/ai-runtime/js-runtime'
import type { JsonObject } from '../../electron/main/services/ai-runtime/types'
import modelManifest from '../../resources/model-manifest.json'
import { bailianQwenImage30Model } from './bailian/qwen-image-3.0.model'
import { bailianZImageTurboModel } from './bailian/z-image-turbo.model'
import { volcengineSeedream50LiteModel } from './volcengine/seedream-5.0-lite.model'
import { volcengineSeedream50ProModel } from './volcengine/seedream-5.0-pro.model'

const OFFICIAL_IMAGE_MODELS = [
  bailianQwenImage30Model,
  bailianZImageTurboModel,
  volcengineSeedream50LiteModel,
  volcengineSeedream50ProModel,
]

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation 官方图片模型', () => {
  it.each(OFFICIAL_IMAGE_MODELS)('$meta.id 在画布按比例与分辨率两个标量参数渲染', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each(OFFICIAL_IMAGE_MODELS.map((model) => model.meta.id))(
    '%s 的 manifest builder 可在独立 VM 执行',
    (modelId) => {
      expect(evaluateManifestBuilder(modelId, { prompt: 'test' })).toBeTruthy()
    }
  )

  it('百炼 Qwen 使用同步多模态契约并限制输入与输出数量', () => {
    const request = bailianQwenImage30Model.request?.builder?.({
      prompt: 'edit',
      uploadedFilePaths: ['a.png', 'b.png', 'c.png', 'd.png'],
      bailianQwenImage30AspectRatio: '16:9',
      bailianQwenImage30Resolution: '2K',
      bailianQwenImage30Count: 9,
    })
    expect(request).toMatchObject({
      model: 'qwen-image-3.0',
      input: { messages: [{ role: 'user' }] },
      parameters: { n: 6, size: '2728*1536', prompt_extend: true, watermark: false },
    })
    expect(request?.input.messages[0].content).toHaveLength(4)
    expect(request?.parameters).not.toHaveProperty('seed')
    expect(request?.parameters).not.toHaveProperty('negative_prompt')
    expect(request?.parameters).not.toHaveProperty('output_format')
    expect(bailianQwenImage30Model.pricing.calculator?.({
      uploadedFilePaths: ['a.png', 'b.png'], bailianQwenImage30Count: 2,
    })).toBeCloseTo(0.4)
  })

  it('百炼 Z-Image 保留 1K/2K 显示并按提示词改写计价', () => {
    const request = bailianZImageTurboModel.request?.builder?.({
      prompt: 'portrait',
      bailianZImageTurboAspectRatio: '3:4',
      bailianZImageTurboResolution: '1K',
      bailianZImageTurboPromptExtend: true,
    })
    expect(request).toMatchObject({
      model: 'z-image-turbo',
      parameters: { size: '888*1184', prompt_extend: true, watermark: false },
    })
    expect(bailianZImageTurboModel.pricing.calculator?.({ bailianZImageTurboPromptExtend: false })).toBe(0.1)
    expect(bailianZImageTurboModel.pricing.calculator?.({ bailianZImageTurboPromptExtend: true })).toBe(0.2)
  })

  it('Seedream Lite 使用方舟组图契约并限制参考图与最大输出数', () => {
    const request = volcengineSeedream50LiteModel.request?.builder?.({
      prompt: 'storyboard',
      uploadedFilePaths: Array.from({ length: 12 }, (_, index) => `${index}.png`),
      volcengineSeedream50LiteAspectRatio: '4:3',
      volcengineSeedream50LiteResolution: '4K',
      volcengineSeedream50LiteCount: 20,
    })
    expect(request).toMatchObject({
      model: 'doubao-seedream-5-0-260128',
      size: '4736x3552',
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 15 },
      response_format: 'url',
    })
    expect(request?.image).toHaveLength(10)
    expect(request).not.toHaveProperty('seed')
    expect(request).not.toHaveProperty('negative_prompt')
    expect(request).not.toHaveProperty('output_format')
    expect(volcengineSeedream50LiteModel.pricing.calculator?.({ volcengineSeedream50LiteCount: 3 })).toBeCloseTo(0.66)
  })

  it('Seedream Pro 使用单图契约并只在请求中发送方舟字段', () => {
    const request = volcengineSeedream50ProModel.request?.builder?.({
      prompt: 'transparent logo',
      uploadedFilePaths: ['a.png'],
      volcengineSeedream50ProAspectRatio: '1:1',
      volcengineSeedream50ProResolution: '1.5K',
      volcengineSeedream50ProBackground: 'transparent',
    })
    expect(request).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628',
      size: '1536x1536',
      background: 'transparent',
      image: ['a.png'],
      response_format: 'url',
    })
    expect(request).not.toHaveProperty('n')
    expect(request).not.toHaveProperty('output_format')
  })
})
