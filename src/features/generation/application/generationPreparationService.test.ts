import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'

import {
  applicationSchemaRefSchema,
  toApplicationStableIdSegment,
} from '@/core/application-control'
import { registry } from '@/core/ModelRegistry'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { USD_TO_CNY_RATE_STORAGE_KEY } from '@/core/pricing/priceDisplay'
import type { ModelDefinition } from '@/core/types'
import { modelPresentations } from '@/models/presentation'

import {
  GenerationPreparationError,
  getGenerationModelCatalogBootstrap,
  getGenerationModelSchema,
  prepareGenerationTask,
  searchGenerationModelCatalog,
  searchGenerationModels,
} from './generationPreparationService'

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
    vi.unstubAllGlobals()
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
    // 模型 id 来自供应商，必须先过稳定 id 规范化再拼，不能直接嵌进去。parse 同时守住
    // 「这个 ref 本身合法」——注册表就是拿它去建 schema 文档的。
    expect(applicationSchemaRefSchema.parse(schema.schemaRef).id)
      .toBe(`generation.model.${toApplicationStableIdSegment(testModel.meta.id)}.params`)
    expect(schema.params).toHaveLength(2)
    expect(schema.priceEstimate).toMatchObject({ amount: 0.5, currency: '$' })
  })

  it('最低估算价排序使用用户设置的美元兑人民币汇率', () => {
    registry.register({
      ...testModel,
      meta: {
        ...testModel.meta,
        id: 'agent-preparation-cny-price',
        provider: 'cny-provider',
      },
      pricing: { currency: '¥', fixed: 3.6 },
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === USD_TO_CNY_RATE_STORAGE_KEY ? '8' : null,
    })

    const models = searchGenerationModels({
      mediaType: 'image',
      sortBy: 'lowest_estimated_price',
    })

    expect(models.map((model) => model.modelId)).toEqual([
      'agent-preparation-cny-price',
      testModel.meta.id,
    ])
    expect(models[1].priceEstimate).toMatchObject({ comparableCnyAmount: 4 })
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

  it('允许父任务 ID 这类自定义参数独立构成输入', () => {
    const taskBasedModel: ModelDefinition = {
      ...testModel,
      meta: { ...testModel.meta, id: 'agent-preparation-task-input', type: 'video' },
      alternativeInputParamIds: ['sourceTaskId'],
      params: [{
        id: 'sourceTaskId', type: 'text', valueType: 'string', order: 1,
        name: { zh: '来源任务', en: 'Source Task' }, default: '', required: true,
      }],
      request: { builder: (params) => ({ task_id: params.sourceTaskId }) },
    }
    registry.register(taskBasedModel)
    expect(prepareGenerationTask({
      modelId: taskBasedModel.meta.id,
      prompt: '',
      mediaType: 'video',
      options: { sourceTaskId: 'task-1' },
    })).toMatchObject({ prepared: true })
  })

  it('KIE Z-Image 比例配置与供应商接口文档保持一致', () => {
    const runtimeModel = catalog.find((model) => model.meta.id === 'kie-z-image')
    expect(runtimeModel).toBeTruthy()
    const model = composeModelDefinition(runtimeModel!, modelPresentations['kie-z-image'])
    const aspectRatio = model.params.find((param) => param.id === 'kieZImageAspectRatio')
    expect(aspectRatio?.type).toBe('dropdown')
    const values = aspectRatio?.type === 'dropdown'
      ? aspectRatio.options.map((option) => option.value)
      : []
    expect(values).toEqual(['smart', '1:1', '4:3', '3:4', '16:9', '9:16'])
  })
})
