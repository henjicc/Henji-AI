import { describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { kiePresentation } from '@/models/presentation/kie'
import { catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { kieGptImage2Model as kieGptImage2Runtime } from '../../src/catalog/kie/gpt-image-2.model'
import { kieGrokImagine20Model as kieGrokImagine20Runtime } from '../../src/catalog/kie/grok-imagine-2.0.model'
import { kieNanoBanana2Model as kieNanoBanana2Runtime } from '../../src/catalog/kie/nano-banana-2.model'
import { kieNanoBanana2LiteModel as kieNanoBanana2LiteRuntime } from '../../src/catalog/kie/nano-banana-2-lite.model'
import { kieNanoBananaProModel as kieNanoBananaProRuntime } from '../../src/catalog/kie/nano-banana-pro.model'
import { kieQwenImage30Model as kieQwenImage30Runtime } from '../../src/catalog/kie/qwen-image-3.0.model'
import { kieSeedream50LiteModel as kieSeedream50LiteRuntime } from '../../src/catalog/kie/seedream-5.0-lite.model'
import { kieSeedream50ProModel as kieSeedream50ProRuntime } from '../../src/catalog/kie/seedream-5.0-pro.model'
import { kieZImageModel as kieZImageRuntime } from '../../src/catalog/kie/z-image.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, kiePresentation[runtime.meta.id])

const kieGptImage2Model = compose(kieGptImage2Runtime)
const kieGrokImagine20Model = compose(kieGrokImagine20Runtime)
const kieNanoBanana2Model = compose(kieNanoBanana2Runtime)
const kieNanoBanana2LiteModel = compose(kieNanoBanana2LiteRuntime)
const kieNanoBananaProModel = compose(kieNanoBananaProRuntime)
const kieQwenImage30Model = compose(kieQwenImage30Runtime)
const kieSeedream50LiteModel = compose(kieSeedream50LiteRuntime)
const kieSeedream50ProModel = compose(kieSeedream50ProRuntime)
const kieZImageModel = compose(kieZImageRuntime)

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation KIE 图片模型', () => {
  it.each([
    kieGptImage2Model,
    kieNanoBanana2Model,
    kieNanoBananaProModel,
    kieQwenImage30Model,
    kieSeedream50LiteModel,
    kieSeedream50ProModel,
  ])('$meta.id 在画布按比例与分辨率两个标量参数渲染', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each([
    'kie-gpt-image-2',
    'kie-nano-banana-2',
    'kie-nano-banana-2-lite',
    'kie-nano-banana-pro',
    'kie-qwen-image-3.0',
    'kie-seedream-5.0-lite',
    'kie-seedream-5.0-pro',
    'kie-grok-imagine-2.0',
    'kie-z-image',
  ])('%s 的 catalog builder 可直接执行', (modelId) => {
    expect(evaluateCatalogBuilder(modelId, { prompt: 'test' })).toMatchObject({ input: { prompt: 'test' } })
  })

  it('GPT Image 2 按有无图片切换端点并保留完整 1K/2K/4K 价格', () => {
    expect(kieGptImage2Model.inputLimits).toMatchObject({ images: { max: 16 } })
    expect(kieGptImage2Model.request?.builder?.({
      prompt: 'edit',
      uploadedFilePaths: ['https://example.com/a.png'],
      kieGptImage2AspectRatio: '16:9',
      kieGptImage2Resolution: '4K'
    })).toEqual({
      model: 'gpt-image-2-image-to-image',
      input: {
        prompt: 'edit',
        aspect_ratio: '16:9',
        resolution: '4K',
        input_urls: ['https://example.com/a.png']
      }
    })
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '1K' })).toBe(0.03)
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '2K' })).toBe(0.05)
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '4K' })).toBe(0.08)
    expect(() => kieGptImage2Model.request?.builder?.({
      prompt: 'invalid', uploadedFilePaths: ['a.png'],
      kieGptImage2AspectRatio: '1:1', kieGptImage2Resolution: '4K'
    })).toThrow('1:1 比例不支持 4K')
  })

  it('Nano Banana 2 与 Pro 不展示也不发送输出格式', () => {
    expect(kieNanoBanana2Model.params.some((param) => /output.?format/i.test(param.id))).toBe(false)
    expect(kieNanoBananaProModel.params.some((param) => /output.?format/i.test(param.id))).toBe(false)

    const request = kieNanoBananaProModel.request?.builder?.({
      prompt: 'portrait',
      kieNanoBananaAspectRatio: 'smart',
      kieNanoBananaResolution: '4K',
      __firstImageRatio: 16 / 9
    })
    expect(request).toMatchObject({
      model: 'nano-banana-pro',
      input: { aspect_ratio: '16:9', resolution: '4K' }
    })
    expect(request?.input).not.toHaveProperty('output_format')
    expect(kieNanoBananaProModel.pricing.calculator?.({ kieNanoBananaResolution: '4K' })).toBe(0.12)
  })

  it('Nano Banana Pro 使用 KIE 完整比例集合、1K 默认值与 8 张上限', () => {
    const aspect = kieNanoBananaProModel.params.find((param) => param.id === 'kieNanoBananaAspectRatio')
    const resolution = kieNanoBananaProModel.params.find((param) => param.id === 'kieNanoBananaResolution')
    expect(aspect?.type).toBe('dropdown')
    if (!aspect || aspect.type !== 'dropdown') throw new Error('Nano Banana Pro 比例参数应为下拉框')
    expect(aspect.options.map((option) => option.value)).toContain('21:9')
    expect(resolution?.default).toBe('1K')
    expect(kieNanoBananaProModel.inputLimits).toMatchObject({ images: { max: 8 } })
  })

  it('Nano Banana 2 Lite 使用独立图片字段且没有分辨率参数', () => {
    expect(kieNanoBanana2LiteModel.params.some((param) => /resolution/i.test(param.id))).toBe(false)
    expect(kieNanoBanana2LiteModel.request?.builder?.({
      prompt: 'lite', uploadedFilePaths: Array.from({ length: 12 }, (_, index) => `${index}.png`)
    })).toMatchObject({
      model: 'nano-banana-2-lite',
      input: { image_urls: Array.from({ length: 10 }, (_, index) => `${index}.png`) }
    })
  })

  it('Seedream 5.0 Lite 用 2K/3K/4K 展示并映射 KIE quality', () => {
    const resolutionParam = kieSeedream50LiteModel.params.find(
      (param) => param.id === 'kieSeedream50LiteResolution'
    )
    expect(resolutionParam).toMatchObject({
      type: 'dropdown',
      default: '2K',
      options: [
        { value: '2K', label: '2K' },
        { value: '3K', label: '3K' },
        { value: '4K', label: '4K' }
      ]
    })
    expect(kieSeedream50LiteModel.request?.builder?.({
      prompt: 'poster',
      kieSeedream50LiteAspectRatio: '3:2',
      kieSeedream50LiteResolution: '4K'
    })).toMatchObject({
      model: 'seedream/5-lite-text-to-image',
      input: { aspect_ratio: '3:2', quality: 'ultra' }
    })
  })

  it('Seedream 5.0 Pro 将 1K/2K 映射为 basic/high，并按额外输入图计价', () => {
    expect(kieSeedream50ProModel.request?.builder?.({
      prompt: 'edit',
      uploadedFilePaths: ['a.png', 'b.png'],
      kieSeedream50ProAspectRatio: '4:3',
      kieSeedream50ProResolution: '2K'
    })).toMatchObject({
      model: 'seedream/5-pro-image-to-image',
      input: { aspect_ratio: '4:3', quality: 'high', image_urls: ['a.png', 'b.png'] }
    })
    expect(kieSeedream50ProModel.pricing.calculator?.({
      uploadedFilePaths: ['a.png', 'b.png'],
      kieSeedream50ProResolution: '2K'
    })).toBeCloseTo(0.0725)
  })

  it('Seedream 5.0 Pro 图层拆分使用独立模型、单图字段和专属尺寸', () => {
    expect(kieSeedream50ProModel.request?.builder?.({
      prompt: 'split layers',
      uploadedFilePaths: ['source.png'],
      kieSeedream50ProMode: 'layer-decomposition',
      kieSeedream50ProLayerSize: '2K'
    })).toEqual({
      model: 'seedream/5-pro-layer-decomposition',
      input: {
        prompt: 'split layers',
        image_url: 'source.png',
        size: '2K'
      }
    })
    expect(() => kieSeedream50ProModel.request?.builder?.({
      kieSeedream50ProMode: 'layer-decomposition',
      uploadedFilePaths: ['a.png', 'b.png']
    })).toThrow('必须且只能输入 1 张图片')
    expect(kieSeedream50ProModel.pricing.calculator?.({
      kieSeedream50ProMode: 'layer-decomposition', kieSeedream50ProLayerSize: '2K'
    })).toBe(0.07)
  })

  it('Qwen Image 3.0 自动路由并固定省略 output_format', () => {
    const request = kieQwenImage30Model.request?.builder?.({
      prompt: 'edit',
      uploadedFilePaths: ['a.png'],
      kieQwenImage30AspectRatio: 'smart',
      kieQwenImage30Resolution: '2K',
      __firstImageRatio: 0.6
    })
    expect(request).toMatchObject({
      model: 'qwen3/image-to-image',
      input: {
        image_size: '9:16',
        resolution: '2K',
        prompt_extend: true,
        image_urls: ['a.png']
      }
    })
    expect(request?.input).not.toHaveProperty('output_format')
    expect(kieQwenImage30Model.pricing.calculator?.({ uploadedFilePaths: ['a.png'] })).toBe(0.0265)
  })

  it('Qwen Image 3.0 Pro 使用 KIE 的 Pro 路由和分档价格', () => {
    expect(kieQwenImage30Model.request?.builder?.({
      prompt: 'dense layout',
      kieQwenImage30Variant: 'pro',
      kieQwenImage30Resolution: '2K'
    })).toMatchObject({ model: 'qwen3-pro/text-to-image' })
    expect(kieQwenImage30Model.request?.builder?.({
      prompt: 'edit', uploadedFilePaths: ['a.png'], kieQwenImage30Variant: 'pro'
    })).toMatchObject({ model: 'qwen3/pro-image-to-image' })
    expect(kieQwenImage30Model.pricing.calculator?.({
      kieQwenImage30Variant: 'pro', kieQwenImage30Resolution: '2K', uploadedFilePaths: ['a.png']
    })).toBeCloseTo(0.0625)
  })

  it('Grok Imagine Image 2.0 映射文生图与直接多图编辑', () => {
    expect(kieGrokImagine20Model.request?.builder?.({
      prompt: 'replace sky',
      uploadedFilePaths: ['a.png', 'b.png'],
      kieGrokImagine20AspectRatio: 'smart'
    })).toEqual({
      model: 'grok-imagine-image-2-0/image-edit',
      input: { prompt: 'replace sky', aspect_ratio: 'auto', image_urls: ['a.png', 'b.png'] }
    })
    expect(kieGrokImagine20Model.inputLimits).toMatchObject({ images: { max: 5 } })
  })

  it('Z-Image 使用 Turbo 通用标识与 KIE 当前美元价格', () => {
    expect(kieZImageModel.meta.canonicalModelId).toBe('z-image-turbo')
    expect(kieZImageModel.pricing.currency).toBe('$')
    expect(kieZImageModel.pricing.calculator?.({})).toBe(0.004)
  })
})
