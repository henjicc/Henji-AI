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
import { seedreamV4Model } from './fal/seedream-v4.model'
import { seedreamV45Model } from './fal/seedream-v4.5.model'
import { nanoBanana2Model } from './ppio/nano-banana-2.model'
import { seedream40Model } from './ppio/seedream-4.0.model'
import { seedream45Model } from './ppio/seedream-4.5.model'
import { seedream50LiteModel } from './ppio/seedream-5.0-lite.model'

const migratedModels = [
  seedreamV4Model,
  seedreamV45Model,
  nanoBanana2Model,
  seedream40Model,
  seedream45Model,
  seedream50LiteModel,
]

function parseSize(value: DynamicValue): { width: number; height: number } {
  const match = String(value).match(/^(\d+)x(\d+)$/)
  expect(match).toBeTruthy()
  return { width: Number(match?.[1]), height: Number(match?.[2]) }
}

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('存量模型画布比例与分辨率迁移', () => {
  it.each(migratedModels)('$meta.id 可在生成页识别为比例/分辨率组合', (model) => {
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it('PPIO Nano Banana 2 使用独立标量构建请求和价格', () => {
    const request = nanoBanana2Model.request?.builder?.({
      prompt: 'test',
      ppioNanoBanana2AspectRatio: '16:9',
      ppioNanoBanana2Resolution: '4K',
    })
    expect(request).toMatchObject({ aspect_ratio: '16:9', size: '4K' })
    expect(nanoBanana2Model.pricing.calculator?.({ ppioNanoBanana2Resolution: '4K' })).toBe(1.057)
  })

  it.each([
    [seedream40Model, { ppioSeedream40AspectRatio: '16:9', ppioSeedream40Resolution: '4K' }, true],
    [seedream45Model, { ppioSeedream45AspectRatio: '9:16', ppioSeedream45Resolution: '4K' }, false],
    [seedream50LiteModel, { ppioSeedream50LiteAspectRatio: '3:2', ppioSeedream50LiteResolution: '4K' }, true],
  ] as const)('$meta.id 将独立标量换算为合法 size', async (model, params, landscape) => {
    const request = await model.request?.builder?.({ prompt: 'test', ...params })
    const size = parseSize(request?.size)
    expect(size.width > size.height).toBe(landscape)
    expect(size.width * size.height).toBeLessThanOrEqual(
      model.meta.id === 'ppio-seedream-5.0-lite' ? 10404496 : 16777216
    )
  })

  it('Fal Seedream 4/4.5 将独立标量换算为 image_size', async () => {
    const landscape = await seedreamV4Model.request?.builder?.({
      prompt: 'test',
      falSeedreamV4AspectRatio: '16:9',
      falSeedreamV4Resolution: '4K',
    })
    const portrait = await seedreamV45Model.request?.builder?.({
      prompt: 'test',
      falSeedreamV45AspectRatio: '9:16',
      falSeedreamV45Resolution: '2K',
    })
    expect(landscape?.image_size).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
    expect(portrait?.image_size).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
    const landscapeSize = landscape?.image_size as DynamicValueMap
    const portraitSize = portrait?.image_size as DynamicValueMap
    expect(Number(landscapeSize.width)).toBeGreaterThan(Number(landscapeSize.height))
    expect(Number(portraitSize.width)).toBeLessThan(Number(portraitSize.height))
  })

  it('旧工程保存的复合参数仍可构建请求', async () => {
    const ppioRequest = await seedream40Model.request?.builder?.({
      prompt: 'legacy',
      resolution: { aspectRatio: '3:2', quality: '2K', width: 2400, height: 1600 },
    })
    const falRequest = await seedreamV4Model.request?.builder?.({
      prompt: 'legacy',
      falSeedreamV4Resolution: { aspectRatio: '3:2', quality: '2K', width: 2400, height: 1600 },
    })
    expect(ppioRequest?.size).toBe('2400x1600')
    expect(falRequest?.image_size).toEqual({ width: 2400, height: 1600 })
  })

  it.each([
    ['ppio-nano-banana-2', { ppioNanoBanana2AspectRatio: '16:9', ppioNanoBanana2Resolution: '4K' }, { aspect_ratio: '16:9', size: '4K' }],
    ['ppio-seedream-4.0', { ppioSeedream40AspectRatio: '16:9', ppioSeedream40Resolution: '4K' }, { size: expect.stringMatching(/^\d+x\d+$/) }],
    ['ppio-seedream-4.5', { ppioSeedream45AspectRatio: '9:16', ppioSeedream45Resolution: '2K' }, { size: expect.stringMatching(/^\d+x\d+$/) }],
    ['ppio-seedream-5.0-lite', { ppioSeedream50LiteAspectRatio: '3:2', ppioSeedream50LiteResolution: '4K' }, { size: expect.stringMatching(/^\d+x\d+$/) }],
    ['fal-ai-bytedance-seedream-v4', { falSeedreamV4AspectRatio: '16:9', falSeedreamV4Resolution: '4K' }, { image_size: expect.any(Object) }],
    ['fal-ai-bytedance-seedream-v4.5', { falSeedreamV45AspectRatio: '9:16', falSeedreamV45Resolution: '2K' }, { image_size: expect.any(Object) }],
  ] as const)('%s 的 manifest builder 可在独立 VM 使用新参数', (modelId, params, expected) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test', ...params })).toMatchObject(expected)
  })
})
