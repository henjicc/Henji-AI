import { describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { modelPresentations } from '@/models/presentation'
import { catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { bailianQwenImage30Model as bailianQwenImage30Runtime } from '../../src/catalog/bailian/qwen-image-3.0.model'
import { bailianZImageTurboModel as bailianZImageTurboRuntime } from '../../src/catalog/bailian/z-image-turbo.model'
import { volcengineSeedream50LiteModel as volcengineSeedream50LiteRuntime } from '../../src/catalog/volcengine/seedream-5.0-lite.model'
import { volcengineSeedream50ProModel as volcengineSeedream50ProRuntime } from '../../src/catalog/volcengine/seedream-5.0-pro.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, modelPresentations[runtime.meta.id])

const bailianQwenImage30Model = compose(bailianQwenImage30Runtime)
const bailianZImageTurboModel = compose(bailianZImageTurboRuntime)
const volcengineSeedream50LiteModel = compose(volcengineSeedream50LiteRuntime)
const volcengineSeedream50ProModel = compose(volcengineSeedream50ProRuntime)

const OFFICIAL_IMAGE_MODELS = [
  bailianQwenImage30Model,
  bailianZImageTurboModel,
  volcengineSeedream50LiteModel,
  volcengineSeedream50ProModel,
]

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation 官方图片模型', () => {
  it.each(OFFICIAL_IMAGE_MODELS)('$meta.id 在画布按比例与分辨率两个标量参数渲染', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each(OFFICIAL_IMAGE_MODELS.map((model) => model.meta.id))(
    '%s 的 catalog builder 可直接执行',
    (modelId) => {
      expect(evaluateCatalogBuilder(modelId, { prompt: 'test' })).toBeTruthy()
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
    expect(bailianQwenImage30Model.pricing.calculator?.({
      uploadedFilePaths: [], uploadedImages: ['fresh-a.png', 'fresh-b.png'], bailianQwenImage30Count: 2,
    })).toBeCloseTo(0.4)
  })

  it('百炼 Qwen Pro 使用官方模型 ID 与 1K/2K 分档价格', () => {
    expect(bailianQwenImage30Model.request?.builder?.({
      prompt: 'worksheet', bailianQwenImage30Variant: 'pro', bailianQwenImage30Resolution: '2K'
    })).toMatchObject({ model: 'qwen-image-3.0-pro' })
    expect(bailianQwenImage30Model.pricing.calculator?.({
      bailianQwenImage30Variant: 'pro', bailianQwenImage30Resolution: '2K', bailianQwenImage30Count: 2,
      uploadedFilePaths: ['a.png']
    })).toBeCloseTo(1.02)
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
      size: '4704x3520',
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 3 },
      response_format: 'url',
    })
    expect(request?.image).toHaveLength(12)
    expect(request).not.toHaveProperty('seed')
    expect(request).not.toHaveProperty('negative_prompt')
    expect(request).not.toHaveProperty('output_format')
    expect(volcengineSeedream50LiteModel.pricing.calculator?.({ volcengineSeedream50LiteCount: 3 })).toBeCloseTo(0.66)
    expect(volcengineSeedream50LiteModel.pricing.calculator?.({
      uploadedFilePaths: [], uploadedImages: Array.from({ length: 13 }, (_, index) => `${index}.png`),
      volcengineSeedream50LiteCount: 3,
    })).toBeCloseTo(0.44)
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

  it('Seedream Pro 图层拆分走方舟同模型专属契约并按输出图层计价', () => {
    expect(volcengineSeedream50ProModel.request?.builder?.({
      prompt: 'separate layers',
      uploadedFilePaths: ['source.png'],
      volcengineSeedream50ProMode: 'layer-decomposition',
      volcengineSeedream50ProLayerSize: 'auto'
    })).toEqual({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'separate layers',
      image: 'source.png',
      layer_decomposition: true,
      size: 'auto',
      response_format: 'url',
      watermark: false
    })
    expect(() => volcengineSeedream50ProModel.request?.builder?.({
      volcengineSeedream50ProMode: 'layer-decomposition',
      uploadedFilePaths: []
    })).toThrow('必须且只能输入 1 张图片')
    expect(Number.isNaN(volcengineSeedream50ProModel.pricing.calculator?.({
      volcengineSeedream50ProMode: 'layer-decomposition', volcengineSeedream50ProLayerSize: '1.5K'
    }) ?? 0)).toBe(true)
    expect(volcengineSeedream50ProModel.pricing.calculator?.({
      volcengineSeedream50ProResolution: '2K', uploadedFilePaths: ['a.png', 'b.png']
    })).toBeCloseTo(0.62)
    expect(volcengineSeedream50ProModel.pricing.calculator?.({
      volcengineSeedream50ProResolution: '2K', uploadedFilePaths: [], uploadedImages: ['a.png', 'b.png']
    })).toBeCloseTo(0.62)
  })
})
