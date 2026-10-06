import { beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types/index'
import { useSettingsStore } from '@/stores/settingsStore'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'

import { applyApplicationSettingsChange, getApplicationSettings, planApplicationSettingsChange, searchApplicationSettings } from '@/features/settings/application-control/index'

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
    useSettingsStore.getState().setVideoEditShortcuts({})
    useSettingsStore.getState().setUiBlurEnabled(true)
    useSettingsStore.getState().setThemeContrast('standard')
  })
  it('剪辑键位封闭对象由正式设置提交，冲突不写入，空配置恢复默认', () => {
    const config = { select_tool: { code: 'F9', ctrl: false, alt: false, shift: false, meta: false } }
    const plan = planApplicationSettingsChange([{ id: 'video_edit.shortcuts', value: config }])
    applyApplicationSettingsChange(plan.planRef)
    expect(useSettingsStore.getState().videoEditShortcuts).toEqual(config)
    expect(getApplicationSettings(['video_edit.shortcuts']).settings[0]).toMatchObject({ value: config })
    expect(() => planApplicationSettingsChange([{ id: 'video_edit.shortcuts', value: { select_tool: { ...config.select_tool, code: 'KeyC' } } }])).toThrow('INVALID_INPUT')
    expect(useSettingsStore.getState().videoEditShortcuts).toEqual(config)
    applyApplicationSettingsChange(planApplicationSettingsChange([{ id: 'video_edit.shortcuts', value: {} }]).planRef)
    expect(useSettingsStore.getState().videoEditShortcuts).toEqual({})
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
    useSettingsStore.getState().setThemeContrast('soft')
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
    const next = before === 'siliconflow' ? 'volcengine-speech' : 'siliconflow'
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
