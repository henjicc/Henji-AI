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
import { apimartGptImage2Model } from './gpt-image-2.model'
import { apimartGrokImagine20Model } from './grok-imagine-2.0.model'
import { apimartMidjourneyModel } from './midjourney.model'
import { apimartNanoBanana2Model } from './nano-banana-2.model'
import { apimartNanoBananaProModel } from './nano-banana-pro.model'
import { apimartQwenImage30Model } from './qwen-image-3.0.model'
import { apimartSeedream50LiteModel } from './seedream-5.0-lite.model'
import { apimartSeedream50ProModel } from './seedream-5.0-pro.model'
import { apimartZImageTurboModel } from './z-image-turbo.model'

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation APIMart 图片模型', () => {
  it.each([
    apimartGptImage2Model,
    apimartGrokImagine20Model,
    apimartNanoBanana2Model,
    apimartNanoBananaProModel,
    apimartQwenImage30Model,
    apimartSeedream50LiteModel,
    apimartSeedream50ProModel,
    apimartZImageTurboModel,
  ])('$meta.id 在画布按比例与分辨率两个标量参数渲染', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each([
    'apimart-gpt-image-2',
    'apimart-grok-imagine-2.0',
    'apimart-midjourney',
    'apimart-nano-banana-2',
    'apimart-nano-banana-pro',
    'apimart-qwen-image-3.0',
    'apimart-seedream-5.0-lite',
    'apimart-seedream-5.0-pro',
    'apimart-z-image-turbo',
  ])('%s 的 manifest builder 可在独立 VM 执行', (modelId) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test' })).toMatchObject({ prompt: 'test' })
  })

  it('所有模型使用 APIMart 对应端点和平台模型 ID', () => {
    expect(apimartGptImage2Model.endpoints).toBe('/v1/images/generations')
    expect(apimartGptImage2Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gpt-image-2' })
    expect(apimartNanoBanana2Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gemini-3.1-flash-image-preview' })
    expect(apimartNanoBananaProModel.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gemini-3-pro-image-preview' })
    expect(apimartQwenImage30Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'qwen-image-3.0' })
    expect(apimartMidjourneyModel).toMatchObject({ endpoints: '/v1/midjourney/generations' })
  })

  it('图片输入按各平台限制截断且不发送默认隐藏字段', () => {
    const imageUrls = Array.from({ length: 20 }, (_, index) => `https://example.com/${index}.png`)
    const gptRequest = apimartGptImage2Model.request?.builder?.({ prompt: 'edit', uploadedFilePaths: imageUrls })
    const qwenRequest = apimartQwenImage30Model.request?.builder?.({ prompt: 'edit', uploadedFilePaths: imageUrls })
    expect(gptRequest?.image_urls).toHaveLength(16)
    expect(qwenRequest?.image_urls).toHaveLength(3)
    expect(gptRequest).not.toHaveProperty('seed')
    expect(gptRequest).not.toHaveProperty('negative_prompt')
    expect(gptRequest).not.toHaveProperty('output_format')
  })

  it('GPT Image 2 显示 K 档并映射 APIMart 小写 resolution', () => {
    expect(apimartGptImage2Model.request?.builder?.({
      prompt: 'poster', apimartGptImage2AspectRatio: '16:9', apimartGptImage2Resolution: '4K'
    })).toMatchObject({ size: '16:9', resolution: '4k', n: 1 })
    expect(apimartGptImage2Model.pricing.calculator?.({ apimartGptImage2Resolution: '4K' })).toBe(0.021)
  })

  it('Seedream Lite 强制参考图与输出图总数不超过 15', () => {
    const request = apimartSeedream50LiteModel.request?.builder?.({
      prompt: 'series',
      uploadedFilePaths: Array.from({ length: 12 }, (_, index) => `${index}.png`),
      apimartSeedream50LiteCount: 10,
      apimartSeedream50LiteResolution: '4K'
    })
    expect(request).toMatchObject({ n: 3, resolution: '4K', sequential_image_generation: 'auto' })
    expect(apimartSeedream50LiteModel.pricing.calculator?.({
      uploadedFilePaths: Array.from({ length: 12 }, () => 'x.png'), apimartSeedream50LiteCount: 10
    })).toBeCloseTo(3 * 0.0228)
  })

  it('Seedream Pro 保留 1.5K 与透明背景平台能力', () => {
    expect(apimartSeedream50ProModel.request?.builder?.({
      prompt: 'logo', apimartSeedream50ProResolution: '1.5K', apimartSeedream50ProBackground: 'transparent'
    })).toMatchObject({ resolution: '1.5K', background: 'transparent' })
    expect(apimartSeedream50ProModel.pricing.calculator?.({ apimartSeedream50ProResolution: '1.5K' })).toBe(0.036)
  })

  it('Grok 保留 quality 档位并按输出数量计价', () => {
    expect(apimartGrokImagine20Model.request?.builder?.({
      prompt: 'scene', apimartGrokImagine20Count: 4
    })).toMatchObject({ model: 'grok-imagine-2.0-ext', n: 4, resolution: 'quality' })
    expect(apimartGrokImagine20Model.pricing.calculator?.({ apimartGrokImagine20Count: 4 })).toBe(0.06)
  })

  it('Z-Image 只在开启提示词改写时使用双倍价格', () => {
    expect(apimartZImageTurboModel.request?.builder?.({
      prompt: 'portrait', apimartZImageTurboPromptExtend: false
    })).toMatchObject({ model: 'z-image-turbo', prompt_extend: false })
    expect(apimartZImageTurboModel.pricing.calculator?.({ apimartZImageTurboPromptExtend: false })).toBe(0.01)
    expect(apimartZImageTurboModel.pricing.calculator?.({ apimartZImageTurboPromptExtend: true })).toBe(0.02)
  })
})
