import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import {
  GenerationPreparationError,
  getGenerationModelSchema,
  prepareGenerationTask,
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
  pricing: { currency: '$', fixed: 0 },
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
      candidate: true,
      availableInRegistry: true,
      canonicalModelId: 'nano-banana',
      providerId: 'test-provider',
      hardConstraints: {
        mediaTypeMatched: true,
        providerMatched: true,
        tagsMatched: true,
      },
    })
    const schema = getGenerationModelSchema(testModel.meta.id)
    expect(schema.schemaVersion).toBe('generation-model-schema/v2')
    expect(schema.params).toHaveLength(2)
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
})
