import { beforeAll, describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { EndpointSelector } from '@/core/request/EndpointSelector'
import { requestBuilder } from '@/core/request/RequestBuilder'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { apimartPresentation } from '@/models/presentation/apimart'
import { catalog, catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { apimartGptImage2Model as apimartGptImage2Runtime } from '../../src/catalog/apimart/gpt-image-2.model'
import { apimartGrokImagine20Model as apimartGrokImagine20Runtime } from '../../src/catalog/apimart/grok-imagine-2.0.model'
import { apimartMidjourneyModel as apimartMidjourneyRuntime } from '../../src/catalog/apimart/midjourney.model'
import { apimartMidjourneyVideoModel as apimartMidjourneyVideoRuntime } from '../../src/catalog/apimart/midjourney-video.model'
import { apimartNanoBanana2Model as apimartNanoBanana2Runtime } from '../../src/catalog/apimart/nano-banana-2.model'
import { apimartNanoBanana2LiteModel as apimartNanoBanana2LiteRuntime } from '../../src/catalog/apimart/nano-banana-2-lite.model'
import { apimartNanoBananaProModel as apimartNanoBananaProRuntime } from '../../src/catalog/apimart/nano-banana-pro.model'
import { apimartQwenImage30Model as apimartQwenImage30Runtime } from '../../src/catalog/apimart/qwen-image-3.0.model'
import { apimartSeedream50LiteModel as apimartSeedream50LiteRuntime } from '../../src/catalog/apimart/seedream-5.0-lite.model'
import { apimartSeedream50ProModel as apimartSeedream50ProRuntime } from '../../src/catalog/apimart/seedream-5.0-pro.model'
import { apimartZImageTurboModel as apimartZImageTurboRuntime } from '../../src/catalog/apimart/z-image-turbo.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, apimartPresentation[runtime.meta.id])

const apimartGptImage2Model = compose(apimartGptImage2Runtime)
const apimartGrokImagine20Model = compose(apimartGrokImagine20Runtime)
const apimartMidjourneyModel = compose(apimartMidjourneyRuntime)
const apimartMidjourneyVideoModel = compose(apimartMidjourneyVideoRuntime)
const apimartNanoBanana2Model = compose(apimartNanoBanana2Runtime)
const apimartNanoBanana2LiteModel = compose(apimartNanoBanana2LiteRuntime)
const apimartNanoBananaProModel = compose(apimartNanoBananaProRuntime)
const apimartQwenImage30Model = compose(apimartQwenImage30Runtime)
const apimartSeedream50LiteModel = compose(apimartSeedream50LiteRuntime)
const apimartSeedream50ProModel = compose(apimartSeedream50ProRuntime)
const apimartZImageTurboModel = compose(apimartZImageTurboRuntime)

beforeAll(() => {
  registry.clear()
  ;[
    apimartGptImage2Model,
    apimartGrokImagine20Model,
    apimartMidjourneyModel,
    apimartMidjourneyVideoModel,
    apimartNanoBanana2Model,
    apimartNanoBanana2LiteModel,
    apimartNanoBananaProModel,
    apimartQwenImage30Model,
    apimartSeedream50LiteModel,
    apimartSeedream50ProModel,
    apimartZImageTurboModel,
  ].forEach((model) => registry.register(model))
})

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation APIMart 图片模型', () => {
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
    'apimart-nano-banana-2-lite',
    'apimart-nano-banana-pro',
    'apimart-qwen-image-3.0',
    'apimart-seedream-5.0-lite',
    'apimart-seedream-5.0-pro',
    'apimart-z-image-turbo',
  ])('%s 的 catalog builder 可直接执行', (modelId) => {
    expect(evaluateCatalogBuilder(modelId, { prompt: 'test' })).toMatchObject({ prompt: 'test' })
  })

  it('所有模型使用 APIMart 对应端点和平台模型 ID', () => {
    expect(apimartGptImage2Model.endpoints).toBe('/v1/images/generations')
    expect(apimartGptImage2Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gpt-image-2' })
    expect(apimartNanoBanana2Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gemini-3.1-flash-image-preview' })
    expect(apimartNanoBananaProModel.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'gemini-3-pro-image-preview' })
    expect(apimartQwenImage30Model.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'qwen-image-3.0' })
    expect(apimartMidjourneyModel.endpoints).toMatchObject({ selector: expect.any(Function) })
  })

  it('Midjourney Imagine 传递结构化参数、垫图和参考图', () => {
    expect(apimartMidjourneyModel.request?.builder?.({
      prompt: 'cinematic portrait',
      images: ['input.png'],
      apimartMidjourneyAspectRatio: '16:9',
      apimartMidjourneySpeed: 'turbo',
      apimartMidjourneyVersion: '6',
      apimartMidjourneyNiji: true,
      apimartMidjourneyStylize: 800,
      apimartMidjourneyChaos: 25,
      apimartMidjourneyTile: true,
      apimartMidjourneyStyleReference: ['https://example.com/style.png'],
      apimartMidjourneyStyleWeight: 500,
      apimartMidjourneyExtra: '--exp 10'
    })).toMatchObject({
      prompt: 'cinematic portrait',
      image_urls: ['input.png'],
      size: '16:9',
      speed: 'turbo',
      version: '6',
      niji: true,
      stylize: 800,
      chaos: 25,
      tile: true,
      sref: 'https://example.com/style.png',
      sw: 500,
      extra: '--exp 10',
      nsfw_check: false
    })
    const request = apimartMidjourneyModel.request?.builder?.({ prompt: 'safe default' })
    expect(request).not.toHaveProperty('model')
    expect(request).not.toHaveProperty('seed')
    expect(request).not.toHaveProperty('negative_prompt')
    expect(apimartMidjourneyModel.pricing.calculator?.({
      apimartMidjourneySpeed: 'fast', apimartMidjourneyRepeat: 3
    })).toBeCloseTo(0.16512)
  })

  it('Midjourney 不发送当前版本不支持的参数', () => {
    expect(apimartMidjourneyModel.request?.builder?.({
      prompt: 'safe version flags',
      apimartMidjourneyVersion: '7',
      apimartMidjourneyHd: true,
      apimartMidjourneyStop: 50
    })).not.toMatchObject({ hd: true, stop: 50 })
  })

  it('Midjourney 在单个模型内按模式切换端点、约束与请求', async () => {
    const selector = new EndpointSelector(apimartMidjourneyModel.endpoints)
    await expect(selector.select({ apimartMidjourneyMode: 'imagine' }, {}))
      .resolves.toMatchObject({ route: { path: '/v1/midjourney/generations' } })
    await expect(selector.select({ apimartMidjourneyMode: 'edit' }, {}))
      .resolves.toMatchObject({ route: { path: '/v1/midjourney/generations/edits' } })
    await expect(selector.select({ apimartMidjourneyMode: 'blend' }, {}))
      .resolves.toMatchObject({ route: { path: '/v1/midjourney/generations/blend' } })

    expect(apimartMidjourneyModel.request?.builder?.({
      apimartMidjourneyMode: 'blend', images: ['a.png', 'b.png'], apimartMidjourneyAspectRatio: '3:2'
    })).toMatchObject({ image_urls: ['a.png', 'b.png'], size: '3:2', speed: 'relax' })
    expect(() => apimartMidjourneyModel.request?.builder?.({
      apimartMidjourneyMode: 'blend', images: ['a.png']
    })).toThrow(/2/)

    expect(apimartMidjourneyModel.request?.builder?.({
      apimartMidjourneyMode: 'edit', prompt: 'replace background', images: ['source.png']
    })).toMatchObject({ prompt: 'replace background', image_urls: ['source.png'] })
    expect(resolveInputLimits('apimart-midjourney', { apimartMidjourneyMode: 'blend' }).images)
      .toEqual({ min: 2, max: 4 })
    expect(resolveInputLimits('apimart-midjourney', { apimartMidjourneyMode: 'edit' }).images)
      .toEqual({ min: 1, max: 6 })

    expect(apimartMidjourneyVideoModel.request?.builder?.({
      prompt: 'camera moves',
      images: ['start.png', 'end.png'],
      apimartMidjourneyVideoResolution: '720p',
      apimartMidjourneyVideoBatchSize: '2'
    })).toMatchObject({
      image_urls: ['start.png'],
      end_url: 'end.png',
      video_type: 'vid_1.1_i2v_start_end_720',
      batch_size: 2
    })
    expect(apimartMidjourneyVideoModel.request?.builder?.({
      apimartMidjourneyVideoTaskId: 'task-1',
      apimartMidjourneyVideoAnimateMode: 'auto',
      apimartMidjourneyVideoIndex: '3'
    })).toMatchObject({ task_id: 'task-1', index: 3, animate_mode: 'auto' })
    expect(apimartMidjourneyVideoModel.request?.builder?.({
      images: ['uploaded.png'],
      apimartMidjourneyVideoTaskId: 'stale-task',
      apimartMidjourneyVideoAnimateMode: 'auto'
    })).toMatchObject({ image_urls: ['uploaded.png'], animate_mode: 'manual' })
    expect(resolveInputLimits('apimart-midjourney-video', {
      apimartMidjourneyVideoTaskId: 'task-1'
    }).images.max).toBe(0)
    expect(resolveInputLimits('apimart-midjourney-video', {
      apimartMidjourneyVideoTaskId: 'stale-task', images: ['uploaded.png']
    }).images.max).toBe(2)
    expect(apimartMidjourneyVideoModel.pricing.calculator?.({
      apimartMidjourneyVideoResolution: '720p', apimartMidjourneyVideoBatchSize: '4'
    })).toBe(1.6)
  })

  it('Midjourney 统一模型的 catalog 与旧 ID 兼容模式可执行', async () => {
    expect(evaluateCatalogBuilder('apimart-midjourney', {
      apimartMidjourneyMode: 'blend', images: ['a.png', 'b.png']
    }))
      .toMatchObject({ image_urls: ['a.png', 'b.png'] })
    expect(evaluateCatalogBuilder('apimart-midjourney', {
      apimartMidjourneyMode: 'edit', prompt: 'edit', images: ['a.png']
    }))
      .toMatchObject({ image_urls: ['a.png'] })
    expect(catalog.some((model) => model.meta.id === 'apimart-midjourney-edit')).toBe(false)
    expect(catalog.some((model) => model.meta.id === 'apimart-midjourney-blend')).toBe(false)
    await expect(requestBuilder.build('apimart-midjourney-edit', { prompt: 'edit', images: ['a.png'] }))
      .resolves.toMatchObject({ url: '/v1/midjourney/generations/edits', body: { image_urls: ['a.png'] } })
    await expect(requestBuilder.build('apimart-midjourney-blend', {
      images: ['a.png', 'b.png'],
      apimartMidjourneyBlendAspectRatio: '16:9',
      apimartMidjourneyBlendSpeed: 'turbo',
    })).resolves.toMatchObject({
      url: '/v1/midjourney/generations/blend',
      body: { image_urls: ['a.png', 'b.png'], size: '16:9', speed: 'turbo' },
    })
    expect(evaluateCatalogBuilder('apimart-midjourney-video', { apimartMidjourneyVideoTaskId: 'task-1' }))
      .toMatchObject({ task_id: 'task-1' })
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
    expect(apimartGptImage2Model.params[0]).toMatchObject({
      id: 'apimartGptImage2Version', order: 1, default: 'ext',
      name: { key: 'params.fields.apiChannel' },
      options: [
        { value: 'ext', label: { key: 'params.options.regular' } },
        { value: 'official', label: { key: 'params.options.official' } }
      ]
    })
    expect(apimartGptImage2Model.request?.builder?.({
      prompt: 'poster', apimartGptImage2AspectRatio: '16:9', apimartGptImage2Resolution: '4K'
    })).toMatchObject({ model: 'gpt-image-2', size: '16:9', resolution: '4k', n: 1, nsfw_check: false })
    expect(apimartGptImage2Model.pricing.calculator?.({ apimartGptImage2Resolution: '4K' })).toBe(0.021)
  })

  it('GPT Image 2 在同一个模型内切换官方渠道并联动专属参数', () => {
    expect(apimartGptImage2Model.meta.aliases).toContain('apimart-gpt-image-2-official')
    expect(apimartGptImage2Model.request?.builder?.({
      prompt: 'replace object',
      uploadedFilePaths: ['source.png'],
      apimartGptImage2Version: 'official',
      apimartGptImage2AspectRatio: '3:2',
      apimartGptImage2Resolution: '4K',
      apimartGptImage2Quality: 'high',
      apimartGptImage2Background: 'transparent',
      apimartGptImage2Count: 3,
      apimartGptImage2MaskUrl: ['mask.png']
    })).toEqual({
      model: 'gpt-image-2-official', prompt: 'replace object', n: 3, size: '3:2',
      resolution: '4k', quality: 'high', background: 'transparent',
      image_urls: ['source.png'], mask_url: 'mask.png', nsfw_check: false
    })
    expect(() => apimartGptImage2Model.request?.builder?.({
      prompt: 'invalid', apimartGptImage2Version: 'official', apimartGptImage2MaskUrl: ['mask.png']
    })).toThrow('必须同时提供至少 1 张参考图')
    expect(apimartGptImage2Model.pricing.calculator?.({
      apimartGptImage2Version: 'official', apimartGptImage2Resolution: '2K',
      apimartGptImage2Quality: 'medium', apimartGptImage2Count: 2
    })).toBeCloseTo(0.3392)
    const qualityParam = apimartGptImage2Model.params.find((param) => param.id === 'apimartGptImage2Quality')
    expect(qualityParam).toMatchObject({ order: 4, visible: { condition: expect.any(Function) } })
    const qualityVisible = qualityParam?.visible?.condition
    expect(typeof qualityVisible === 'function' && qualityVisible({ apimartGptImage2Version: 'ext' })).toBe(false)
    expect(typeof qualityVisible === 'function' && qualityVisible({ apimartGptImage2Version: 'official' })).toBe(true)
    expect(evaluateCatalogBuilder('apimart-gpt-image-2', {
      prompt: 'official catalog',
      apimartGptImage2Version: 'official',
      apimartGptImage2Quality: 'high'
    })).toMatchObject({ model: 'gpt-image-2-official', quality: 'high' })
    expect(catalog.some((model) => model.meta.id === 'apimart-gpt-image-2-official')).toBe(false)
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

  it('Nano Banana 2 主模型支持 0.5K 与搜索联动，Lite 使用独立固定 1K 契约', () => {
    expect(apimartNanoBanana2Model.request?.builder?.({
      prompt: 'current event',
      apimartNanoBanana2Resolution: '0.5K',
      apimartNanoBanana2GoogleImageSearch: true
    })).toMatchObject({
      model: 'gemini-3.1-flash-image-preview', resolution: '0.5K',
      google_search: true, google_image_search: true
    })
    expect(apimartNanoBanana2LiteModel.params.some((param) => /resolution/i.test(param.id))).toBe(false)
    expect(apimartNanoBanana2LiteModel.request?.builder?.({
      prompt: 'batch', uploadedFilePaths: Array.from({ length: 20 }, (_, index) => `${index}.png`),
      apimartNanoBanana2LiteCount: 8
    })).toMatchObject({ model: 'gemini-3.1-flash-lite-image-ext', n: 4 })
    expect(apimartNanoBanana2LiteModel.request?.builder?.({
      uploadedFilePaths: Array.from({ length: 20 }, (_, index) => `${index}.png`)
    })?.image_urls).toHaveLength(14)
  })

  it('Nano Banana Pro APIMart 使用 14 张上限与完整非极端比例集合', () => {
    const request = apimartNanoBananaProModel.request?.builder?.({
      prompt: 'reference set',
      uploadedFilePaths: Array.from({ length: 20 }, (_, index) => `${index}.png`),
      apimartNanoBananaProAspectRatio: '21:9'
    })
    expect(apimartNanoBananaProModel.inputLimits).toMatchObject({ images: { max: 14 } })
    expect(request).toMatchObject({ size: '21:9', resolution: '1K' })
    expect(request?.image_urls).toHaveLength(14)
  })

  it('Seedream Pro 保留 1.5K 与透明背景平台能力', () => {
    expect(apimartSeedream50ProModel.request?.builder?.({
      prompt: 'logo', apimartSeedream50ProResolution: '1.5K', apimartSeedream50ProBackground: 'transparent'
    })).toMatchObject({ resolution: '1.5K', background: 'transparent' })
    expect(apimartSeedream50ProModel.pricing.calculator?.({ apimartSeedream50ProResolution: '1.5K' })).toBe(0.02928)
  })

  it('Seedream Pro 图层拆分严格使用单图、专属字段和按图层价格', () => {
    expect(apimartSeedream50ProModel.inputLimits).toMatchObject({
      rules: [{ when: 'apimartSeedream50ProMode === "layer-decomposition"', images: { min: 1, max: 1 } }]
    })
    expect(apimartSeedream50ProModel.request?.builder?.({
      prompt: 'split foreground',
      uploadedFilePaths: ['source.png'],
      apimartSeedream50ProMode: 'layer-decomposition',
      apimartSeedream50ProLayerSize: '1.5K'
    })).toEqual({
      model: 'seedream-5-0-pro',
      prompt: 'split foreground',
      image_urls: ['source.png'],
      layer_decomposition: true,
      size: '1.5K'
    })
    expect(() => apimartSeedream50ProModel.request?.builder?.({
      apimartSeedream50ProMode: 'layer-decomposition'
    })).toThrow('必须且只能输入 1 张图片')
    expect(apimartSeedream50ProModel.pricing.calculator?.({
      apimartSeedream50ProMode: 'layer-decomposition',
      apimartSeedream50ProLayerSize: '1.5K'
    })).toBe(0.01464)
  })

  it('Grok EXT 只发送白名单字段并按输出数量计价', () => {
    expect(apimartGrokImagine20Model.params[0]).toMatchObject({
      id: 'apimartGrokImagine20Version', order: 1, default: 'ext',
      name: { key: 'params.fields.apiChannel' },
      options: [
        { value: 'ext', label: { key: 'params.options.regular' } },
        { value: 'official', label: { key: 'params.options.official' } }
      ]
    })
    expect(apimartGrokImagine20Model.request?.builder?.({
      prompt: 'scene', apimartGrokImagine20Count: 4
    })).toEqual({
      model: 'grok-imagine-2.0-ext', prompt: 'scene', n: 4, size: '1:1', nsfw_check: false
    })
    expect(apimartGrokImagine20Model.pricing.calculator?.({ apimartGrokImagine20Count: 4 })).toBe(0.06)
    expect(() => apimartGrokImagine20Model.request?.builder?.({
      prompt: 'edit', images: ['source.png']
    })).toThrow('请切换为官方渠道')
  })

  it('Grok 在同一个模型内切换官方渠道，并联动多图、比例、分辨率与计价', () => {
    expect(apimartGrokImagine20Model.meta.aliases).toContain('apimart-grok-imagine-2.0-official')
    const request = apimartGrokImagine20Model.request?.builder?.({
      prompt: 'merge references',
      uploadedFilePaths: ['a.png', 'b.png'],
      apimartGrokImagine20Version: 'official',
      apimartGrokImagine20AspectRatio: '19.5:9',
      apimartGrokImagine20Resolution: '2K',
      apimartGrokImagine20Quality: 'low',
      apimartGrokImagine20Count: 2
    })
    expect(request).toMatchObject({
      model: 'grok-imagine-image-2.0', aspect_ratio: '19.5:9', resolution: '2k',
      n: 2, image_urls: ['a.png', 'b.png'], nsfw_check: false
    })
    expect(request).not.toHaveProperty('quality')
    expect(apimartGrokImagine20Model.pricing.calculator?.({
      uploadedFilePaths: ['a.png', 'b.png'],
      apimartGrokImagine20Version: 'official',
      apimartGrokImagine20Resolution: '2K',
      apimartGrokImagine20Quality: 'low',
      apimartGrokImagine20Count: 2
    })).toBeCloseTo(0.112)
    expect(apimartGrokImagine20Model.inputLimits).toMatchObject({
      images: { max: 0 },
      rules: [{ when: 'apimartGrokImagine20Version === "official"', images: { max: 3 } }]
    })
    expect(resolveInputLimits(apimartGrokImagine20Model.meta.id, {
      apimartGrokImagine20Version: 'ext'
    }).images.max).toBe(0)
    expect(resolveInputLimits(apimartGrokImagine20Model.meta.id, {
      apimartGrokImagine20Version: 'official'
    }).images.max).toBe(3)

    expect(evaluateCatalogBuilder('apimart-grok-imagine-2.0', {
      prompt: 'official catalog',
      apimartGrokImagine20Version: 'official',
      apimartGrokImagine20Resolution: '2K'
    })).toMatchObject({ model: 'grok-imagine-image-2.0', resolution: '2k' })
    expect(catalog.some((model) => model.meta.id === 'apimart-grok-imagine-2.0-official')).toBe(false)
  })

  it('Z-Image 只在开启提示词改写时使用双倍价格', () => {
    expect(apimartZImageTurboModel.request?.builder?.({
      prompt: 'portrait', apimartZImageTurboPromptExtend: false
    })).toMatchObject({ model: 'z-image-turbo', prompt_extend: false })
    expect(apimartZImageTurboModel.pricing.calculator?.({ apimartZImageTurboPromptExtend: false })).toBe(0.01)
    expect(apimartZImageTurboModel.pricing.calculator?.({ apimartZImageTurboPromptExtend: true })).toBe(0.02)
  })

  it('Qwen Image 3.0 可切换标准版与 Pro，并保持 APIMart 默认不扩写提示词', () => {
    expect(apimartQwenImage30Model.request?.builder?.({
      prompt: 'newspaper',
      apimartQwenImage30Variant: 'pro',
      apimartQwenImage30Resolution: '2K'
    })).toMatchObject({
      model: 'qwen-image-3.0-pro',
      prompt_extend: false,
      resolution: '2K'
    })
    expect(apimartQwenImage30Model.request?.builder?.({
      prompt: 'edit', apimartQwenImage30PromptExtend: true
    })).toMatchObject({ prompt_extend: true, prompt_extend_mode: 'direct' })
    expect(apimartQwenImage30Model.pricing.calculator?.({
      apimartQwenImage30Variant: 'pro', apimartQwenImage30Resolution: '2K', apimartQwenImage30Count: 2
    })).toBeCloseTo(0.1142864)
  })

  it.each([
    {
      model: apimartNanoBanana2Model,
      paramId: 'apimartNanoBanana2Channel',
      standardId: 'gemini-3.1-flash-image-preview',
      officialId: 'gemini-3.1-flash-image-preview-official',
      standardParams: { apimartNanoBanana2Resolution: '2K' },
      officialParams: { apimartNanoBanana2Channel: 'official', apimartNanoBanana2Resolution: '2K' },
      standardPrice: 0.02,
      officialPrice: 0.0808,
    },
    {
      model: apimartNanoBanana2LiteModel,
      paramId: 'apimartNanoBanana2LiteChannel',
      standardId: 'gemini-3.1-flash-lite-image-ext',
      officialId: 'gemini-3.1-flash-lite-image',
      standardParams: { apimartNanoBanana2LiteCount: 2 },
      officialParams: { apimartNanoBanana2LiteChannel: 'official', apimartNanoBanana2LiteCount: 2 },
      standardPrice: 0.025,
      officialPrice: 0.064,
    },
    {
      model: apimartNanoBananaProModel,
      paramId: 'apimartNanoBananaProChannel',
      standardId: 'gemini-3-pro-image-preview',
      officialId: 'gemini-3-pro-image-preview-official',
      standardParams: { apimartNanoBananaProResolution: '4K' },
      officialParams: { apimartNanoBananaProChannel: 'official', apimartNanoBananaProResolution: '4K' },
      standardPrice: 0.04,
      officialPrice: 0.192,
    },
  ])('$model.meta.id 以第一顺位渠道参数无损切换 APIMart 双渠道', ({
    model, paramId, standardId, officialId, standardParams, officialParams, standardPrice, officialPrice,
  }) => {
    expect(model.params[0]).toMatchObject({
      id: paramId,
      order: 1,
      default: 'standard',
      role: 'channel',
      name: { key: 'params.fields.apiChannel' },
      options: [
        { value: 'standard', label: { key: 'params.options.regular' } },
        { value: 'official', label: { key: 'params.options.official' } },
      ],
    })
    expect(model.request?.builder?.({ prompt: 'default' })).toMatchObject({ model: standardId })
    expect(model.request?.builder?.({ prompt: 'standard', ...standardParams })).toMatchObject({ model: standardId })
    expect(model.request?.builder?.({ prompt: 'official', ...officialParams })).toMatchObject({ model: officialId })
    expect(model.pricing.calculator?.(standardParams)).toBeCloseTo(standardPrice)
    expect(model.pricing.calculator?.(officialParams)).toBeCloseTo(officialPrice)
  })

  it('APIMart Seedream 只接受官方比例并拒绝插件旧非法比例', () => {
    expect(apimartSeedream50ProModel.request?.builder?.({
      prompt: 'wide', apimartSeedream50ProAspectRatio: '2:1'
    })).toMatchObject({ size: '2:1' })
    expect(apimartSeedream50LiteModel.request?.builder?.({
      prompt: 'tall', apimartSeedream50LiteAspectRatio: '1:2'
    })).toMatchObject({ size: '1:2' })
    expect(() => apimartSeedream50ProModel.request?.builder?.({
      prompt: 'invalid', apimartSeedream50ProAspectRatio: '4:5'
    })).toThrow(/不支持图片比例/)
    expect(() => apimartSeedream50LiteModel.request?.builder?.({
      prompt: 'invalid', apimartSeedream50LiteAspectRatio: '5:4'
    })).toThrow(/不支持图片比例/)
  })

  it('APIMart 旧插件边界以官方契约为准', () => {
    expect(() => apimartMidjourneyModel.request?.builder?.({
      apimartMidjourneyMode: 'edit', prompt: 'edit',
      images: Array.from({ length: 7 }, (_, index) => `${index}.png`),
    })).toThrow(/1–6/)
    const longPrompt = '图'.repeat(900)
    expect(apimartZImageTurboModel.request?.builder?.({ prompt: longPrompt })?.prompt).toHaveLength(800)
    expect(apimartGptImage2Model.request?.builder?.({
      prompt: 'official edit', images: ['input.png'], apimartGptImage2Version: 'official'
    })).toMatchObject({ quality: 'auto', background: 'auto', nsfw_check: false })
  })
})
