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

const migratedModels = [
  seedreamV4Model,
  seedreamV45Model,
]

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
    const falRequest = await seedreamV4Model.request?.builder?.({
      prompt: 'legacy',
      falSeedreamV4Resolution: { aspectRatio: '3:2', quality: '2K', width: 2400, height: 1600 },
    })
    expect(falRequest?.image_size).toEqual({ width: 2400, height: 1600 })
  })

  it.each([
    ['fal-ai-bytedance-seedream-v4', { falSeedreamV4AspectRatio: '16:9', falSeedreamV4Resolution: '4K' }, { image_size: expect.any(Object) }],
    ['fal-ai-bytedance-seedream-v4.5', { falSeedreamV45AspectRatio: '9:16', falSeedreamV45Resolution: '2K' }, { image_size: expect.any(Object) }],
  ] as const)('%s 的 manifest builder 可在独立 VM 使用新参数', (modelId, params, expected) => {
    expect(evaluateManifestBuilder(modelId, { prompt: 'test', ...params })).toMatchObject(expected)
  })
})
