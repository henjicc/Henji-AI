// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applicationReflectionHandlers } from '@/features/assistant/applicationCapabilities/applicationReflectionAdapter'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'
import { useSettingsStore } from '@/stores/settingsStore'
import { changeLanguage, getCurrentLanguage } from '@/utils/language'

import { getSettingsRegistryRevision } from './settingsApplicationService'
import { INTERFACE_APPLICATION_SETTING_DEFINITIONS } from './interfaceSettingDefinitions'

describe('设置的正式反射结果', () => {
  let originalLanguage: ReturnType<typeof getCurrentLanguage>
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']
  let originalUiScaleMode: ReturnType<typeof useSettingsStore.getState>['uiScaleMode']
  let originalAutoInsertTextDisplay: boolean
  let originalProvider: ReturnType<typeof modelDefaultsManager.getSnapshot>['providerId']
  let originalImageModel: string

  beforeEach(() => {
    originalLanguage = getCurrentLanguage()
    originalTone = useSettingsStore.getState().themeTonePreset
    originalUiScaleMode = useSettingsStore.getState().uiScaleMode
    originalAutoInsertTextDisplay = useSettingsStore.getState().autoInsertTextDisplayNode
    originalProvider = modelDefaultsManager.getSnapshot().providerId
    originalImageModel = modelDefaultsManager.getSnapshot().models.image
  })

  afterEach(() => {
    changeLanguage(originalLanguage)
    useSettingsStore.getState().setThemeTonePreset(originalTone)
    useSettingsStore.getState().setUiScaleMode(originalUiScaleMode)
    useSettingsStore.getState().setAutoInsertTextDisplayNode(originalAutoInsertTextDisplay)
    modelDefaultsManager.setDefaultModel('image', '')
    modelDefaultsManager.setProvider(originalProvider)
    if (originalImageModel) modelDefaultsManager.setDefaultModel('image', originalImageModel)
    if (registry.getModel('settings-cascade-kie-image')) registry.unregister('settings-cascade-kie-image')
    if (registry.getModel('settings-cascade-fal-image')) registry.unregister('settings-cascade-fal-image')
  })

  function context(requestId: string) {
    return {
      signal: new AbortController().signal,
      requestId,
      expectedRevisions: { settings: getSettingsRegistryRevision() },
    }
  }

  async function change(id: string, value: string | boolean) {
    return applicationReflectionHandlers.changeEntities({
      summary: `修改 ${id}`,
      changes: [{
        kind: 'set_properties',
        target: { kind: 'settings.registry', id: 'singleton' },
        entityType: 'settings.registry',
        properties: { [id]: value },
      }],
    }, context(`settings-${id}`))
  }

  it('素材库边缘触发的公开默认值与新装设置保持关闭', () => {
    const definition = INTERFACE_APPLICATION_SETTING_DEFINITIONS.find(
      (entry) => entry.id === 'assets.edge_trigger',
    )

    expect(definition?.defaultValue).toBe(false)
    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(false)
  })

  it('通过 describe 与 change 切换 general.language，正式读取值随之变化', async () => {
    const described = await applicationReflectionHandlers.describeEntities({
      domains: ['settings'], entityTypes: [], refs: [{ kind: 'settings.registry', id: 'singleton' }],
    }, context('settings-describe-language'))
    expect(described.propertyAvailability[0]?.properties).toContainEqual(expect.objectContaining({
      propertyId: 'general.language', writable: true,
    }))
    const next = originalLanguage === 'en-US' ? 'zh-CN' : 'en-US'
    await change('general.language', next)
    const snapshot = await applicationReflectionHandlers.readEntity({
      ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['general.language'],
    }, context('settings-read-language'))
    expect(snapshot.properties['general.language']).toBe(next)
  })

  it('通过通用 change 修改 interface.theme_tone，zustand 真相源与反射读回一致', async () => {
    const next = originalTone === 'warm' ? 'cool' : 'warm'
    await change('interface.theme_tone', next)
    expect(useSettingsStore.getState().themeTonePreset).toBe(next)
    const snapshot = await applicationReflectionHandlers.readEntity({
      ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'],
    }, context('settings-read-tone'))
    expect(snapshot.properties['interface.theme_tone']).toBe(next)
  })

  it('通过通用 change 修改界面缩放，并持久化且可反射读回', async () => {
    const next = originalUiScaleMode === '90' ? '100' : '90'
    await change('interface.scale', next)

    expect(useSettingsStore.getState().uiScaleMode).toBe(next)
    const snapshot = await applicationReflectionHandlers.readEntity({
      ref: { kind: 'settings.registry', id: 'singleton' },
      propertyIds: ['interface.scale'],
    }, context('settings-read-interface-scale'))
    expect(snapshot.properties['interface.scale']).toBe(next)
    expect(JSON.parse(localStorage.getItem('settings-storage') ?? '{}'))
      .toMatchObject({ state: { uiScaleMode: next } })
  })

  it('通过通用 change 修改自动插入文本展示，并持久化且可反射读回', async () => {
    const next = !originalAutoInsertTextDisplay
    await change('canvas.auto_insert_text_display', next)

    expect(useSettingsStore.getState().autoInsertTextDisplayNode).toBe(next)
    const snapshot = await applicationReflectionHandlers.readEntity({
      ref: { kind: 'settings.registry', id: 'singleton' },
      propertyIds: ['canvas.auto_insert_text_display'],
    }, context('settings-read-auto-text-display'))
    expect(snapshot.properties['canvas.auto_insert_text_display']).toBe(next)
    expect(JSON.parse(localStorage.getItem('settings-storage') ?? '{}'))
      .toMatchObject({ state: { autoInsertTextDisplayNode: next } })
  })

  it('切换默认供应商时为被清空的默认模型返回级联 Effect，并从真相源读回', async () => {
    const createModel = (id: string, canonicalModelId: string, provider: string): ModelDefinition => ({
      meta: {
        id,
        canonicalModelId,
        provider,
        type: 'image',
        name: { zh: id, en: id },
        tags: [],
      },
      inputLimits: { images: { max: 0 }, videos: { max: 0 }, audios: { max: 0 } },
      params: [],
      linkages: [],
      endpoints: '/test',
      request: { builder: (params) => params },
      pricing: { currency: '$', fixed: 1 },
    })
    registry.register(createModel('settings-cascade-kie-image', 'nano-banana', 'kie'))
    registry.register(createModel('settings-cascade-fal-image', 'nano-banana-2', 'fal'))
    modelDefaultsManager.setProvider('kie')
    modelDefaultsManager.setDefaultModel('image', 'nano-banana')

    const result = await change('general.primary_provider', 'fal')

    expect(result.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effect: 'update',
        entityType: 'settings.registry',
        propertyIds: ['generation.default_image_model'],
        origin: {
          kind: 'cascade',
          declarationId: 'settings.generation.default_image_model.cleared',
        },
      }),
    ]))
    const snapshot = await applicationReflectionHandlers.readEntity({
      ref: { kind: 'settings.registry', id: 'singleton' },
      propertyIds: ['general.primary_provider', 'generation.default_image_model'],
    }, context('settings-read-defaults-after-provider-change'))
    expect(snapshot.properties).toMatchObject({
      'general.primary_provider': 'fal',
      'generation.default_image_model': 'auto',
    })
  })
})
