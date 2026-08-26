import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core', async () => {
  const [{ defineModel }, modelText] = await Promise.all([
    import('@/core/defineModel'),
    import('@/core/i18n/modelText'),
  ])
  return { defineModel, ...modelText }
})

import { evalFunction } from '../../../electron/main/services/ai-runtime/js-runtime'
import type { JsonObject } from '../../../electron/main/services/ai-runtime/types'
import modelManifest from '../../../resources/model-manifest.json'
import { grsaiGptImage2Model } from './gpt-image-2.model'
import { grsaiNanoBanana2Model } from './nano-banana-2.model'
import { grsaiNanoBanana2LiteModel } from './nano-banana-2-lite.model'
import { grsaiNanoBananaProModel } from './nano-banana-pro.model'

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation Grsai 图片模型', () => {
  it.each([
    'grsai-gpt-image-2',
    'grsai-nano-banana-2',
    'grsai-nano-banana-2-lite',
    'grsai-nano-banana-pro',
  ])('%s 的 manifest builder 可在独立 VM 执行', (modelId) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test' })).toMatchObject({ prompt: 'test' })
  })

  it('端点统一是 Grsai 新版统一生成接口', () => {
    for (const model of [grsaiGptImage2Model, grsaiNanoBanana2Model, grsaiNanoBanana2LiteModel, grsaiNanoBananaProModel]) {
      expect(model.endpoints).toBe('/v1/api/generate')
    }
  })

  it('GPT Image 2：标准渠道发送比例字符串，VIP 渠道发送像素值且分辨率影响输出', () => {
    expect(grsaiGptImage2Model.request?.builder?.({
      prompt: 'cat', grsaiGptImage2Channel: 'standard', grsaiGptImage2AspectRatio: '16:9',
    })).toMatchObject({ model: 'gpt-image-2', prompt: 'cat', aspectRatio: '16:9' })

    expect(grsaiGptImage2Model.request?.builder?.({
      prompt: 'cat', grsaiGptImage2Channel: 'vip', grsaiGptImage2AspectRatio: '16:9', grsaiGptImage2Resolution: '2K',
    })).toMatchObject({ model: 'gpt-image-2-vip', prompt: 'cat', aspectRatio: '2048x1152' })

    expect(grsaiGptImage2Model.request?.builder?.({
      prompt: 'cat', grsaiGptImage2Channel: 'vip', grsaiGptImage2AspectRatio: '1:3', grsaiGptImage2Resolution: '2K',
    })).toMatchObject({ aspectRatio: '688x2048' })

    expect(grsaiGptImage2Model.pricing.calculator?.({ grsaiGptImage2Channel: 'standard' })).toBe(0.06)
    expect(grsaiGptImage2Model.pricing.calculator?.({ grsaiGptImage2Channel: 'vip' })).toBe(0.2)
  })

  it('GPT Image 2：本地图片进入 images 字段等待媒体预处理层内联为 base64', () => {
    expect(grsaiGptImage2Model.request?.builder?.({
      prompt: 'cat', uploadedFilePaths: ['/tmp/a.png'],
    })).toMatchObject({ images: ['/tmp/a.png'] })
  })

  it('Nano Banana 2：标准渠道分辨率可自由选择，CL 渠道绑定固定分辨率与独立 model', () => {
    expect(grsaiNanoBanana2Model.request?.builder?.({
      prompt: 'cat', grsaiNanoBanana2Channel: 'standard', grsaiNanoBanana2Resolution: '2K',
    })).toMatchObject({ model: 'nano-banana-2', imageSize: '2K' })

    expect(grsaiNanoBanana2Model.request?.builder?.({
      prompt: 'cat', grsaiNanoBanana2Channel: 'cl-2k', grsaiNanoBanana2Resolution: '4K',
    })).toMatchObject({ model: 'nano-banana-2-2k-cl', imageSize: '2K' })

    expect(grsaiNanoBanana2Model.pricing.calculator?.({ grsaiNanoBanana2Channel: 'standard' })).toBe(0.12)
    expect(grsaiNanoBanana2Model.pricing.calculator?.({ grsaiNanoBanana2Channel: 'cl-4k' })).toBe(1.3)
  })

  it('Nano Banana 2 Lite：单一渠道，固定 model，不含分辨率参数', () => {
    expect(grsaiNanoBanana2LiteModel.params.some((param) => param.id.toLowerCase().includes('resolution'))).toBe(false)
    expect(grsaiNanoBanana2LiteModel.request?.builder?.({ prompt: 'cat' })).toMatchObject({ model: 'nano-banana-2-lite', prompt: 'cat' })
    expect(grsaiNanoBanana2LiteModel.pricing.calculator?.({})).toBe(0.044)
  })

  it('Nano Banana Pro：VIP 渠道选到 4K 时按约束回退到 2K', () => {
    expect(grsaiNanoBananaProModel.request?.builder?.({
      prompt: 'cat', grsaiNanoBananaProChannel: 'vip', grsaiNanoBananaProResolution: '4K',
    })).toMatchObject({ model: 'nano-banana-pro-vip', imageSize: '2K' })

    expect(grsaiNanoBananaProModel.request?.builder?.({
      prompt: 'cat', grsaiNanoBananaProChannel: 'cl',
    })).toMatchObject({ model: 'nano-banana-pro-cl', imageSize: '1K' })

    expect(grsaiNanoBananaProModel.request?.builder?.({
      prompt: 'cat', grsaiNanoBananaProChannel: '4k-vip',
    })).toMatchObject({ model: 'nano-banana-pro-4k-vip', imageSize: '4K' })

    expect(grsaiNanoBananaProModel.pricing.calculator?.({ grsaiNanoBananaProChannel: 'vt' })).toBe(0.18)
    expect(grsaiNanoBananaProModel.pricing.calculator?.({ grsaiNanoBananaProChannel: '4k-vip' })).toBe(1.8)
  })

  it('Nano Banana Pro：渠道切到 VIP 时分辨率选项联动过滤掉 4K', () => {
    const linkage = grsaiNanoBananaProModel.linkages?.find((item) => item.effect === 'filterOptions')
    expect(linkage).toBeTruthy()
    const resolutionParam = grsaiNanoBananaProModel.params.find((param) => param.id === 'grsaiNanoBananaProResolution')
    const options = resolutionParam && 'options' in resolutionParam ? resolutionParam.options : []
    const filtered = linkage && linkage.effect === 'filterOptions' ? linkage.filter('vip', options, {}) : []
    expect(filtered.map((option) => option.value)).toEqual(['1K', '2K'])
  })

  it('无一个模型注册 seed 或负面提示词参数', () => {
    for (const model of [grsaiGptImage2Model, grsaiNanoBanana2Model, grsaiNanoBanana2LiteModel, grsaiNanoBananaProModel]) {
      expect(model.params.some((param) => param.id.toLowerCase().includes('seed'))).toBe(false)
      expect(model.params.some((param) => param.id.toLowerCase().includes('negative'))).toBe(false)
    }
  })
})
