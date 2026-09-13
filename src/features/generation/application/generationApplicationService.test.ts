// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'
import { generationService } from '@/core/services/GenerationService'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

import { generationApplicationService, selectExecutableGenerationModel } from './generationApplicationService'

function model(id: string, provider: string): ModelDefinition {
  return {
    meta: {
      id, canonicalModelId: 'nano-banana-2', provider, type: 'image',
      name: { zh: id, en: id }, tags: ['text-to-image'],
    },
    inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [], linkages: [], endpoints: '/test', request: { builder: (value) => value },
    pricing: { currency: '$', fixed: 1, description: 'test' },
  }
}

describe('generationApplicationService 可执行模型解析', () => {
  afterEach(() => { for (const type of ['image', 'video', 'audio'] as const) modelDefaultsManager.setDefaultModel(type, ''); vi.restoreAllMocks(); registry.clear() })

  it.each(['image', 'video', 'audio'] as const)('%s 自动选型实时读取设置修改，不沿用旧草稿', async mediaType => {
    const old = model('old', 'kie'); old.meta.type = mediaType
    const next = model('next', 'kie'); next.meta.type = mediaType; next.meta.canonicalModelId = 'nano-banana-pro'
    registry.register(old); registry.register(next)
    modelDefaultsManager.setProvider('kie')
    vi.spyOn(generationService, 'getConfiguredProviders').mockResolvedValue(['kie'])
    modelDefaultsManager.setDefaultModel(mediaType, 'nano-banana-2')
    const input = { currentModelId: 'old', prompt: '测试', mediaType, options: {} }
    expect(await generationApplicationService.resolveModel(input)).toMatchObject({ modelId: 'old', selection: 'user_default' })
    modelDefaultsManager.setDefaultModel(mediaType, 'nano-banana-pro')
    expect(await generationApplicationService.resolveModel(input)).toMatchObject({ modelId: 'next', selection: 'user_default' })
    expect(await generationApplicationService.resolveModel({ ...input, requestedModelId: 'old' })).toMatchObject({ modelId: 'old', selection: 'requested' })
  })

  it('用户明确供应商优先于全局默认，未配置的默认供应商不会拦住可用模型', () => {
    registry.register(model('kie-image', 'kie')); registry.register(model('fal-image', 'fal'))
    const defaults = { modelId: 'kie-image', providerId: 'kie' }
    expect(selectExecutableGenerationModel({ preferredProviderIds: ['fal'], prompt: '图', mediaType: 'image' }, ['kie', 'fal'], defaults)).toMatchObject({ modelId: 'fal-image', selection: 'preferred_provider' })
    expect(selectExecutableGenerationModel({ prompt: '图', mediaType: 'image' }, ['fal'], defaults)).toMatchObject({ modelId: 'fal-image', selection: 'configured_fallback' })
  })

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
