// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import { selectExecutableGenerationModel } from './generationApplicationService'

function model(id: string, provider: string): ModelDefinition {
  return {
    meta: {
      id, canonicalModelId: 'nano-banana', provider, type: 'image',
      name: { zh: id, en: id }, tags: ['text-to-image'],
    },
    inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [], linkages: [], endpoints: '/test', request: { builder: (value) => value },
    pricing: { currency: '$', fixed: 1, description: 'test' },
  }
}

describe('generationApplicationService 可执行模型解析', () => {
  afterEach(() => registry.clear())

  it('当前草稿供应商未配置时选择已配置且兼容的模型', () => {
    registry.register(model('ppio-image', 'ppio'))
    registry.register(model('kie-image', 'kie'))

    expect(selectExecutableGenerationModel({
      currentModelId: 'ppio-image', prompt: '图片', mediaType: 'image', options: {},
    }, ['kie'])).toEqual({
      modelId: 'kie-image', providerId: 'kie', selection: 'configured_fallback',
    })
  })

  it('用户偏好只在已配置且通过正式参数校验的供应商中排序', () => {
    registry.register(model('fal-image', 'fal'))
    registry.register(model('kie-image', 'kie'))

    expect(selectExecutableGenerationModel({
      preferredProviderIds: ['kie'], prompt: '图片', mediaType: 'image', options: {},
    }, ['fal', 'kie'])).toMatchObject({
      modelId: 'kie-image', providerId: 'kie', selection: 'preferred_provider',
    })
  })

  it('显式指定未配置供应商时在提交前拒绝', () => {
    registry.register(model('ppio-image', 'ppio'))

    expect(() => selectExecutableGenerationModel({
      requestedModelId: 'ppio-image', prompt: '图片', mediaType: 'image', options: {},
    }, ['kie'])).toThrow(/供应商尚未配置/)
  })

  it('显式指定受控执行模型时提示改用画布图片能力', () => {
    registry.registerHidden(model('controlled-image', 'fal'))

    expect(() => selectExecutableGenerationModel({
      requestedModelId: 'controlled-image', prompt: '图片', mediaType: 'image', options: {},
    }, ['fal'])).toThrow(/画布图片能力/)
  })
})
