import { beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'

import {
  applyApplicationSettingsChange,
  getApplicationSettings,
  planApplicationSettingsChange,
  searchApplicationSettings,
} from './settingsRegistry'

const defaultImageModel: ModelDefinition = {
  meta: {
    id: 'settings-default-image-test',
    canonicalModelId: 'nano-banana',
    provider: 'kie',
    type: 'image',
    name: { zh: '默认图片测试模型', en: 'Default image test model' },
    tags: [],
  },
  inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
  params: [],
  linkages: [],
  endpoints: '/test',
  request: { builder: (params) => params },
  pricing: { currency: '$', fixed: 1 },
}

describe('assistant settings registry', () => {
  beforeEach(() => {
    useSettingsStore.getState().setUiBlurEnabled(true)
    useSettingsStore.getState().setThemeTonePreset('neutral')
  })

  it('搜索、规划并应用可逆设置', () => {
    expect(searchApplicationSettings('毛玻璃', 10).map((item) => item.id))
      .toContain('interface.blur_enabled')
    const plan = planApplicationSettingsChange([
      { id: 'interface.blur_enabled', value: false },
    ])
    expect(plan.changes[0]).toMatchObject({ before: true, after: false })
    const result = applyApplicationSettingsChange(plan.planRef)
    expect(result.applied).toEqual([
      expect.objectContaining({ id: 'interface.blur_enabled', value: false }),
    ])
    expect(useSettingsStore.getState().uiBlurEnabled).toBe(false)
  })

  it('revision 冲突时不写入', () => {
    const plan = planApplicationSettingsChange([
      { id: 'interface.blur_enabled', value: false },
    ])
    useSettingsStore.getState().setThemeTonePreset('warm')
    expect(() => applyApplicationSettingsChange(plan.planRef)).toThrow('CONFLICT')
    expect(useSettingsStore.getState().uiBlurEnabled).toBe(true)
  })

  it('密钥和路径只返回状态', () => {
    const result = getApplicationSettings([
      'security.provider_keys',
      'storage.download_paths',
    ])
    expect(result.settings[0]).not.toHaveProperty('value')
    expect(result.settings[0]).toHaveProperty('configured')
    expect(result.settings[1]).not.toHaveProperty('value')
    expect(result.settings[1]).not.toHaveProperty('path')
  })

  it('默认供应商通过通用设置能力读写默认项真相源', () => {
    const before = modelDefaultsManager.getSnapshot().providerId
    const next = before === 'fal' ? 'kie' : 'fal'
    const plan = planApplicationSettingsChange([
      { id: 'general.primary_provider', value: next },
    ])
    const applied = applyApplicationSettingsChange(plan.planRef)

    expect(applied.applied).toEqual([
      expect.objectContaining({ id: 'general.primary_provider', value: next }),
    ])
    expect(modelDefaultsManager.getSnapshot().providerId).toBe(next)
    modelDefaultsManager.setProvider(before)
  })

  it('图片默认模型通过通用设置能力读写统一模型标识', () => {
    registry.register(defaultImageModel)
    const beforeProvider = modelDefaultsManager.getSnapshot().providerId
    const beforeImageModel = modelDefaultsManager.getSnapshot().models.image
    modelDefaultsManager.setProvider('kie')
    const plan = planApplicationSettingsChange([
      { id: 'generation.default_image_model', value: 'nano-banana' },
    ])
    const applied = applyApplicationSettingsChange(plan.planRef)

    expect(applied.applied).toEqual([
      expect.objectContaining({ id: 'generation.default_image_model', value: 'nano-banana' }),
    ])
    expect(modelDefaultsManager.getSnapshot().models.image).toBe('nano-banana')

    modelDefaultsManager.setDefaultModel('image', '')
    modelDefaultsManager.setProvider(beforeProvider)
    if (beforeImageModel) modelDefaultsManager.setDefaultModel('image', beforeImageModel)
    registry.unregister(defaultImageModel.meta.id)
  })
})
