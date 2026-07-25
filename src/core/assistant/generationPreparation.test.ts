import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import {
  GenerationPreparationError,
  getGenerationModelCatalogBootstrap,
  getGenerationModelSchema,
  prepareGenerationTask,
  searchGenerationModelCatalog,
  searchGenerationModels,
} from './generationPreparation'

const testModel: ModelDefinition = {
  meta: {
    id: 'agent-preparation-test',
    canonicalModelId: 'nano-banana',
    provider: 'test-provider',
    type: 'image',
    name: { zh: '生成准备测试模型', en: 'Generation preparation test model' },
    tags: ['text-to-image', 'image-to-image'],
  },
  inputLimits: { images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [
    {
      id: 'prompt',
      type: 'textarea',
      valueType: 'string',
      order: 1,
      name: { zh: '提示词', en: 'Prompt' },
      default: '',
      required: true,
    },
    {
      id: 'quality',
      type: 'dropdown',
      valueType: 'string',
      order: 2,
      name: { zh: '质量', en: 'Quality' },
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'high', label: 'High' },
      ],
    },
  ],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => ({ prompt: params.prompt, quality: params.quality }) },
  pricing: { currency: '$', fixed: 0.5, description: '测试模型基础价格' },
}

describe('generationPreparation', () => {
  beforeEach(() => {
    registry.clear()
    registry.register(testModel)
  })

  afterEach(() => {
    registry.clear()
  })

  it('按配置搜索并裁剪单模型 schema', () => {
    const models = searchGenerationModels({
      mediaType: 'image', providerId: 'test-provider', tags: ['text-to-image'],
    })
    expect(models).toHaveLength(1)
    expect(models[0].selectionEvidence).toMatchObject({
      compatible: true,
      recommendedByDescription: false,
    })
    expect(models[0].priceEstimate).toMatchObject({
      amount: 0.5,
      currency: '$',
      billingMode: 'fixed',
      comparableCnyAmount: 3.385,
    })
    const schema = getGenerationModelSchema(testModel.meta.id)
    expect(schema.schemaVersion).toBe('generation-model-schema/v2')
    expect(schema.params).toHaveLength(2)
    expect(schema.priceEstimate).toMatchObject({ amount: 0.5, currency: '$' })
  })

  it('批量候选以紧凑卡片返回，足以一次传递更多模型而不触发目录卸载', () => {
    for (let index = 0; index < 31; index += 1) {
      registry.register({
        ...testModel,
        meta: {
          ...testModel.meta,
          id: `agent-preparation-batch-${index}`,
          canonicalModelId: 'nano-banana',
          name: { zh: `候选 ${index}`, en: `Candidate ${index}` },
          description: { zh: `推荐使用！${'高质量商业视觉'.repeat(12)}`, en: 'Recommended for commercial visual output.' },
        },
      })
    }

    const models = searchGenerationModels({ mediaType: 'image' })
    expect(models).toHaveLength(32)
    expect(Buffer.byteLength(JSON.stringify(models), 'utf8')).toBeLessThan(24 * 1024)
  })

  it('忽略误传的题材词并按供应商标识大小写归一化，避免无效重复搜索', () => {
    const result = searchGenerationModelCatalog({
      mediaType: 'image',
      providerId: 'TEST-PROVIDER',
      query: '剪纸风格',
    })
    expect(result.models).toHaveLength(1)
    expect(result.appliedProviderId).toBe('test-provider')
    expect(result.providerIdNormalized).toBe(true)
    expect(result.matchedQueryTerms).toEqual([])
    expect(result.ignoredQueryTerms).toEqual(['剪纸风格'])
  })

  it('首轮目录按基础模型合并供应商变体，保留选择所需的价格和推荐信息', () => {
    registry.register({
      ...testModel,
      meta: { ...testModel.meta, id: 'agent-preparation-test-variant', provider: 'test-provider-2' },
    })
    const catalog = getGenerationModelCatalogBootstrap()
    expect(catalog.modelGroups).toHaveLength(1)
    expect(catalog.modelGroups[0]).toMatchObject({ canonicalModelId: 'nano-banana' })
    expect(catalog.modelGroups[0].providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'test-provider',
        priceEstimate: expect.objectContaining({ amount: 0.5, currency: '$' }),
      }),
      expect.objectContaining({
        providerId: 'test-provider-2',
        priceEstimate: expect.objectContaining({ comparableCnyAmount: 3.385 }),
      }),
    ]))
  })

  it('合并默认值并在提交前校验媒体和参数', () => {
    const prepared = prepareGenerationTask({
      modelId: testModel.meta.id,
      prompt: '一只猫',
      mediaType: 'image',
      options: { quality: 'high' },
    })
    expect((prepared.options as Record<string, unknown>).quality).toBe('high')
    expect(prepared.selectionEvidence).toMatchObject({
      selectedModelId: testModel.meta.id,
      providerId: 'test-provider',
      schemaValidated: true,
      mediaTypeMatched: true,
    })
    expect(prepared.priceEstimate).toMatchObject({ amount: 0.5, currency: '$' })

    expect(() => prepareGenerationTask({
      modelId: testModel.meta.id,
      prompt: '一只猫',
      mediaType: 'image',
      options: { images: ['one.png', 'two.png'] },
    })).toThrow(GenerationPreparationError)
  })

  it('拒绝与模型配置不匹配的输出媒体类型', () => {
    expect(() => prepareGenerationTask({
      modelId: testModel.meta.id,
      prompt: '一只猫',
      mediaType: 'video',
    })).toThrow('生成媒体类型与模型能力不匹配')
  })

  it('KIE Z-Image 比例配置与供应商接口文档保持一致', () => {
    const source = readFileSync('src/models/kie/z-image.model.ts', 'utf8')
    expect(source).toContain("{ value: '4:3', label: '4:3' }")
    expect(source).toContain("{ value: '3:4', label: '3:4' }")
    expect(source).toContain("{ value: '16:9', label: '16:9' }")
    expect(source).toContain("{ value: '9:16', label: '9:16' }")
    expect(source).not.toContain("{ value: '2:3', label: '2:3' }")
  })
})
