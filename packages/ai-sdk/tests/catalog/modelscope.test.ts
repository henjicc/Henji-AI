import { afterEach, describe, expect, it } from 'vitest'

import { modelscopeCustomModel } from '../../src/catalog/modelscope/modelscope-custom.model'
import { replaceModelscopeCustomModels } from '../../src/catalog/modelscope/customModelRegistry'
import { modelscopeQwenImageEdit2509Model } from '../../src/catalog/modelscope/qwen-image-edit-2509.model'
import { buildModelscopeRequest, MODELSCOPE_CREATE_TASK_ENDPOINT, resolveModelscopeSize } from '../../src/catalog/modelscope/utils'

describe('魔搭提交路由', () => {
  it('SDK catalog 与共享实现都使用官方路由', () => {
    expect(MODELSCOPE_CREATE_TASK_ENDPOINT).toBe('/v1/images/generations')
    expect(modelscopeQwenImageEdit2509Model.endpoints).toBe(MODELSCOPE_CREATE_TASK_ENDPOINT)
  })
})

describe('resolveModelscopeSize 尺寸边界', () => {
  it('FLUX 的上界是 1024，不会算出超过官方上限的边长', () => {
    const size = resolveModelscopeSize('black-forest-labs/FLUX.1-Krea-dev', '1:1', 2048, { min: 64, max: 1024 })
    const [w, h] = (size ?? '').split('x').map(Number)
    expect(w).toBeLessThanOrEqual(1024)
    expect(h).toBeLessThanOrEqual(1024)
  })

  it('Z-Image 的下界是 512，不会算出低于官方下限的边长', () => {
    const size = resolveModelscopeSize('Tongyi-MAI/Z-Image-Turbo', '1:1', 64, { min: 512, max: 2048 })
    const [w, h] = (size ?? '').split('x').map(Number)
    expect(w).toBeGreaterThanOrEqual(512)
    expect(h).toBeGreaterThanOrEqual(512)
  })
})

describe('buildModelscopeRequest 图片来源', () => {
  const options = { modelId: 'Qwen/Qwen-Image-Edit-2509', allowImage: true }

  it('读生成页提交用的 uploadedFilePaths', () => {
    expect(buildModelscopeRequest({ prompt: 'p', uploadedFilePaths: ['a.png', 'b.png'] }, options).image_url)
      .toEqual(['a.png', 'b.png'])
  })

  it('读画布节点用的 images', () => {
    expect(buildModelscopeRequest({ prompt: 'p', images: ['c.png'] }, options).image_url).toEqual(['c.png'])
  })

  it('uploadedFilePaths 优先于 images', () => {
    expect(buildModelscopeRequest({ prompt: 'p', uploadedFilePaths: ['a.png'], images: ['c.png'] }, options).image_url)
      .toEqual(['a.png'])
  })

  it('allowImage 为 false 时不发送图片', () => {
    expect(buildModelscopeRequest({ prompt: 'p', uploadedFilePaths: ['a.png'] }, { modelId: 'Qwen/Qwen-Image', allowImage: false }).image_url)
      .toBeUndefined()
  })

  it('真实 catalog builder 复用同一实现并保留图片契约', async () => {
    const params = { prompt: 'p', uploadedFilePaths: ['a.png', 'b.png'] }
    const actual = await modelscopeQwenImageEdit2509Model.request!.builder!(params)
    const expected = buildModelscopeRequest(params, {
      modelId: 'Qwen/Qwen-Image-Edit-2509', allowGuidance: false, allowNegativePrompt: false,
      allowImage: true, baseSize: 1024, sizeBounds: { min: 64, max: 1664 },
    })
    expect(actual).toEqual(expected)
  })
})

describe('魔搭自定义模型计价', () => {
  afterEach(() => replaceModelscopeCustomModels([]))

  it('使用保存模型时取得的 EstimatedMagicGrainCost', () => {
    replaceModelscopeCustomModels([{
      id: 'Qwen/Qwen-Image-2512',
      name: 'Qwen Image 2512',
      costTier: 'ultra',
      magicGrainCost: 2,
      modelType: { imageGeneration: true, imageEditing: false },
    }])

    expect(modelscopeCustomModel.pricing.calculator?.({
      modelscopeCustomModel: 'Qwen/Qwen-Image-2512',
    })).toBe(2)
  })

  it('旧记录或校验未知时返回不可估算，不再固定显示 1 魔粒', () => {
    replaceModelscopeCustomModels([{
      id: 'Acme/Unknown',
      name: 'Unknown',
      modelType: { imageGeneration: true, imageEditing: false },
    }])

    expect(modelscopeCustomModel.pricing.calculator?.({
      modelscopeCustomModel: 'Acme/Unknown',
    })).toBeNaN()
  })
})
