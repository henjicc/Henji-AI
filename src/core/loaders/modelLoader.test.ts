/** @vitest-environment jsdom */

import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { loadAllModels } from '@/core/loaders/modelLoader'
import type { ParamDef } from '@/core/types'

const migratedStructureDigests = {
  'volcengine-seedream-5.0-lite': '5b060b0992c57ff55750651ec2c8cc138dd952f2c466ab291a489e765d73501f',
  'bailian-qwen-image-3.0': '55fa864900323f9f66ee4fba37e60fe3e364af06c8192c9d0d3e4140ac029ccf',
  'grsai-nano-banana-pro': 'e52830a6cb080856d94df10c4a533a0af900aa7a18b625d68d9a16080fbfecf8',
  'ppio-minimax-speech': 'd18e7aa8953803b053a28e11c25964647267271efc54aeb6231e157da9261823',
  'modelscope-custom': '049cf4b1a0ca9645dba4ec864a70987e3d752d36b37dbd5754bf2262539a3a6f',
  'apimart-midjourney': 'd9bf786e99f81885a6d8a3a108368cf2a62578a35a4fa4b7e24f69ae70a7c422',
  'apimart-midjourney-video': 'c93fe905c5c068a4861127084cd1cdaa92bdc856cb7cca09377b04bf96f87370',
  'kie-hailuo-02': '5c5094dad33b8e0f7f8f2ae2a5d83fe0670181cfa581b8412e3df4a0c397c38f',
  'fal-ai-bytedance-seedream-v4': 'e6b4de37bf188bb20170d6623d5f559fa694a3c535210aaa27f990d38ec5d224',
  'fal-ai-veo-3.1': '5b0a294db374a4bda194baf589cb7b30e7c4bfd80b8ddd406d38c37111f03222',
} as const

function normalizeModelStructure(value: unknown): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'function') return '[Function]'
  if (Array.isArray(value)) return value.map(normalizeModelStructure)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeModelStructure(item)])
    )
  }
  return value
}

function structureDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeModelStructure(value)))
    .digest('hex')
}

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

  it('把 100 个运行时定义与展示补丁完整合成并注册', async () => {
    await expect(loadAllModels()).resolves.toMatchObject({
      total: 100,
      success: 100,
      failed: 0,
    })
    expect(registry.listAllModels()).toHaveLength(100)
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

  it('ModelRegistry 的十类查询在 100 个合成模型上保持完整行为', () => {
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
    expect(stats.totalModels).toBe(100)
    expect(Object.values(stats.providerCounts as Record<string, number>).reduce((sum, count) => sum + count, 0)).toBe(100)
    expect(Number(stats.imageModels) + Number(stats.videoModels) + Number(stats.audioModels)).toBe(100)
  })

  it('十个迁移代表模型与迁移前结构摘要逐项一致', () => {
    for (const [modelId, expectedDigest] of Object.entries(migratedStructureDigests)) {
      const model = registry.getModel(modelId)
      expect(model, modelId).toBeTruthy()
      expect(structureDigest(model), modelId).toBe(expectedDigest)
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
