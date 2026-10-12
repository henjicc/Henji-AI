/** @vitest-environment jsdom */

import { beforeAll, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { loadAllModels } from '@/core/loaders/modelLoader'
import { HENJI_GENERATION_MODELS } from '../modelCatalog/applicationModelProfile'
import { CONTROLLED_EXECUTION_MODELS } from '@/core/modelCatalog/controlledExecutionModels'
import type { ParamDef } from '@/core/types'

function visitParams(params: ParamDef[], visit: (param: ParamDef) => void): void {
  for (const param of params) {
    visit(param)
    if (param.type === 'panel') visitParams(param.children, visit)
  }
}

describe('SDK catalog 应用侧加载入口', () => {
  beforeAll(async () => {
    registry.clear()
  })

  it('按权威 catalog ID 集合注册可选模型，受控模型保持不可发现', async () => {
    await expect(loadAllModels()).resolves.toMatchObject({
      total: HENJI_GENERATION_MODELS.length + CONTROLLED_EXECUTION_MODELS.length,
      success: HENJI_GENERATION_MODELS.length + CONTROLLED_EXECUTION_MODELS.length,
      failed: 0,
    })
    expect(registry.listAllModels().map(model => model.meta.id).sort()).toEqual(HENJI_GENERATION_MODELS.map(model => model.meta.id).sort())
    for (const model of CONTROLLED_EXECUTION_MODELS) {
      expect(registry.getModel(model.meta.id), model.meta.id).toBeTruthy()
      expect(registry.getDiscoverableModel(model.meta.id), model.meta.id).toBeUndefined()
      expect(registry.isModelDiscoverable(model.meta.id), model.meta.id).toBe(false)
      expect(registry.getModelsByType(model.meta.type)).not.toContainEqual(model)
    }
    expect(registry.getDiscoverableModel(registry.listAllModels()[0].meta.id)).toBeTruthy()
  })

  it('五个代表模型保留联动、分组与 composite 面板展示', () => {
    const midjourney = registry.getModel('apimart-midjourney')
    const speech = registry.getModel('ppio-minimax-speech')
    const kieHailuo = registry.getModel('kie-hailuo-02')
    const falSeedream = registry.getModel('fal-ai-bytedance-seedream-v4')
    const modelscopeCustom = registry.getModel('modelscope-custom')

    expect(midjourney?.linkages?.length).toBeGreaterThan(0)
    expect(midjourney?.paramPresentation?.groups.length).toBeGreaterThan(0)
    expect(speech?.params.some((param) => param.type === 'composite' && Boolean(param.config))).toBe(true)
    expect(kieHailuo?.linkages?.length).toBeGreaterThan(0)
    expect(falSeedream?.meta.name).toBeTruthy()
    expect(modelscopeCustom?.meta.name).toBeTruthy()
  })

  it('ModelRegistry 的十类查询在完整目录上保持行为', () => {
    const allModels = registry.listAllModels()
    const firstModel = allModels[0]
    expect(firstModel).toBeTruthy()
    expect(registry.getModel(firstModel.meta.id)).toBe(firstModel)

    const modelWithAlias = allModels.find((model) => (model.meta.aliases?.length ?? 0) > 0)
    expect(modelWithAlias).toBeTruthy()
    expect(registry.getModel(modelWithAlias!.meta.aliases![0])).toBe(modelWithAlias)

    const schema = registry.getSchema(firstModel.meta.id)
    expect(schema).toBe(firstModel.params)
    for (const model of allModels) {
      visitParams(registry.getSchema(model.meta.id), (param) => {
        expect(param.name, `${model.meta.id}.${param.id}`).toBeTruthy()
        if (param.type === 'dropdown' || param.type === 'radio') {
          for (const option of param.options) {
            expect(option.label, `${model.meta.id}.${param.id}.${String(option.value)}`).toBeTruthy()
          }
        }
      })
      expect(registry.getDefaultValues(model.meta.id)).toEqual(
        Object.fromEntries(model.params.map((param) => [param.id, param.default]))
      )
    }

    const provider = firstModel.meta.provider
    expect(new Set(registry.getModelsByProvider(provider).map((model) => model.meta.id))).toEqual(
      new Set(allModels.filter((model) => model.meta.provider === provider).map((model) => model.meta.id))
    )

    const type = firstModel.meta.type
    expect(new Set(registry.getModelsByType(type).map((model) => model.meta.id))).toEqual(
      new Set(allModels.filter((model) => model.meta.type === type).map((model) => model.meta.id))
    )

    const taggedModel = allModels.find((model) => (model.meta.tags?.length ?? 0) > 0)
    expect(taggedModel).toBeTruthy()
    const tag = taggedModel!.meta.tags![0]
    expect(new Set(registry.getModelsByTag(tag).map((model) => model.meta.id))).toEqual(
      new Set(allModels.filter((model) => model.meta.tags?.includes(tag)).map((model) => model.meta.id))
    )

    const dynamicPriceModel = allModels.find((model) => model.pricing.calculator)
    expect(dynamicPriceModel?.pricing.calculator).toBeTruthy()
    const dynamicDefaults = registry.getDefaultValues(dynamicPriceModel!.meta.id)
    expect(registry.calculatePrice(dynamicPriceModel!.meta.id, dynamicDefaults)).toBe(
      dynamicPriceModel!.pricing.calculator!(dynamicDefaults)
    )

    const info = registry.getModelInfo(firstModel.meta.id)
    expect(info).toMatchObject({
      id: firstModel.meta.id,
      provider: firstModel.meta.provider,
      type: firstModel.meta.type,
      paramCount: firstModel.params.length,
      linkageCount: firstModel.linkages?.length ?? 0,
    })

    const stats = registry.getStats()
    expect(stats.totalModels).toBe(HENJI_GENERATION_MODELS.length)
    expect(Object.values(stats.providerCounts as Record<string, number>).reduce((sum, count) => sum + count, 0)).toBe(HENJI_GENERATION_MODELS.length)
    expect(Number(stats.imageModels) + Number(stats.videoModels) + Number(stats.audioModels)).toBe(HENJI_GENERATION_MODELS.length)
  })

  it('代表模型保留执行身份、模式语义、联动及参数分组', () => {
    for (const modelId of ['volcengine-seedream-5.0-lite', 'bailian-qwen-image-3.0', 'grsai-nano-banana-pro', 'modelscope-custom', 'apimart-midjourney', 'apimart-midjourney-video', 'kie-hailuo-02', 'fal-ai-bytedance-seedream-v4', 'fal-ai-veo-3.1']) {
      const runtime = HENJI_GENERATION_MODELS.find(model => model.meta.id === modelId)!
      const model = registry.getModel(modelId)!
      expect(model, modelId).toBeTruthy()
      expect(model.meta.provider, modelId).toBe(runtime.meta.provider)
      expect(model.meta.type, modelId).toBe(runtime.meta.type)
      expect(registry.getDefaultValues(modelId)).toEqual(Object.fromEntries(model.params.map(param => [param.id, param.default])))
    }
    for (const modelId of ['bailian-qwen-image-3.0', 'apimart-midjourney', 'fal-ai-veo-3.1']) {
      expect(registry.getModel(modelId)?.params.some(param => param.role === 'mode'), modelId).toBe(true)
    }

    for (const modelId of ['grsai-nano-banana-pro', 'apimart-midjourney', 'kie-hailuo-02']) {
      expect(registry.getModel(modelId)?.linkages?.length, modelId).toBeGreaterThan(0)
    }
    for (const modelId of ['apimart-midjourney', 'apimart-midjourney-video']) {
      const groups = registry.getModel(modelId)?.paramPresentation?.groups ?? []
      expect(groups.length, modelId).toBeGreaterThan(0)
      expect(groups.some((group) => group.sections.length > 0), modelId).toBe(true)
    }
  })
})
