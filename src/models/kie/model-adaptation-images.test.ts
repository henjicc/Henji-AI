import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core', async () => {
  const [{ defineModel }, modelText] = await Promise.all([
    import('@/core/defineModel'),
    import('@/core/i18n/modelText'),
  ])
  return { defineModel, ...modelText }
})

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { evalFunction } from '../../../electron/main/services/ai-runtime/js-runtime'
import type { JsonObject } from '../../../electron/main/services/ai-runtime/types'
import modelManifest from '../../../resources/model-manifest.json'
import { kieGptImage2Model } from './gpt-image-2.model'
import { kieGrokImagine20Model } from './grok-imagine-2.0.model'
import { kieNanoBanana2Model } from './nano-banana-2.model'
import { kieNanoBananaProModel } from './nano-banana-pro.model'
import { kieQwenImage30Model } from './qwen-image-3.0.model'
import { kieSeedream50LiteModel } from './seedream-5.0-lite.model'
import { kieSeedream50ProModel } from './seedream-5.0-pro.model'
import { kieZImageModel } from './z-image.model'

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation KIE 图片模型', () => {
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
    'kie-nano-banana-pro',
    'kie-qwen-image-3.0',
    'kie-seedream-5.0-lite',
    'kie-seedream-5.0-pro',
    'kie-grok-imagine-2.0',
    'kie-z-image',
  ])('%s 的 manifest builder 可在独立 VM 执行', (modelId) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test' })).toMatchObject({ input: { prompt: 'test' } })
  })

  it('GPT Image 2 按有无图片切换端点并保留完整 1K/2K/4K 价格', () => {
    expect(kieGptImage2Model.inputLimits).toMatchObject({ images: { max: 16 } })
    expect(kieGptImage2Model.request?.builder?.({
      prompt: 'edit',
      uploadedFilePaths: ['https://example.com/a.png'],
      kieGptImage2AspectRatio: '1:1',
      kieGptImage2Resolution: '4K'
    })).toEqual({
      model: 'gpt-image-2-image-to-image',
      input: {
        prompt: 'edit',
        aspect_ratio: '1:1',
        resolution: '4K',
        input_urls: ['https://example.com/a.png']
      }
    })
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '1K' })).toBe(0.03)
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '2K' })).toBe(0.05)
    expect(kieGptImage2Model.pricing.calculator?.({ kieGptImage2Resolution: '4K' })).toBe(0.08)
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

  it('Grok Imagine Image 2.0 映射文生图与任务图片编辑', () => {
    expect(kieGrokImagine20Model.request?.builder?.({
      prompt: 'replace sky',
      kieGrokImagine20Mode: 'image-edit',
      kieGrokImagine20TaskId: 'task-1',
      kieGrokImagine20MaskIndexes: '0, 2, invalid'
    })).toEqual({
      model: 'grok-imagine-image-2-0/image-edit',
      input: { prompt: 'replace sky', task_id: 'task-1', mask_indexs: [0, 2] }
    })
  })

  it('Z-Image 使用 Turbo 通用标识与 KIE 当前美元价格', () => {
    expect(kieZImageModel.meta.canonicalModelId).toBe('z-image-turbo')
    expect(kieZImageModel.pricing.currency).toBe('$')
    expect(kieZImageModel.pricing.calculator?.({})).toBe(0.004)
  })
})
