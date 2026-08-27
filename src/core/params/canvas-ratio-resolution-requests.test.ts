import { describe, expect, it } from 'vitest'
import {
  buildRequest,
  catalogIndex,
  type ModelRuntimeDefinition,
} from '@henjicc/ai-sdk'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { falPresentation } from '@/models/presentation/fal'

function requireRuntimeModel(modelId: string): ModelRuntimeDefinition {
  const model = catalogIndex.get(modelId)
  if (!model) throw new Error(`缺少 SDK catalog 模型：${modelId}`)
  return model
}

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, falPresentation[runtime.meta.id])

const seedreamV4Model = compose(requireRuntimeModel('fal-ai-bytedance-seedream-v4'))
const seedreamV45Model = compose(requireRuntimeModel('fal-ai-bytedance-seedream-v4.5'))

const migratedModels = [
  seedreamV4Model,
  seedreamV45Model,
]

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
    const landscapeSize = landscape?.image_size as Record<string, number>
    const portraitSize = portrait?.image_size as Record<string, number>
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
  ] as const)('%s 的 SDK catalog builder 可直接使用新参数', async (modelId, params, expected) => {
    const built = await buildRequest({ prompt: 'test', ...params }, catalogIndex.get(modelId))
    expect(built.body).toMatchObject(expected)
  })
})
