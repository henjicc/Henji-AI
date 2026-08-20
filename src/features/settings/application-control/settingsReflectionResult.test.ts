// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applicationReflectionHandlers } from '@/features/assistant/applicationCapabilities/applicationReflectionAdapter'
import { useSettingsStore } from '@/stores/settingsStore'
import { changeLanguage, getCurrentLanguage } from '@/utils/language'

import { getSettingsRegistryRevision } from './settingsApplicationService'

describe('设置的正式反射结果', () => {
  let originalLanguage: ReturnType<typeof getCurrentLanguage>
  let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']
  let originalAutoInsertTextDisplay: boolean

  beforeEach(() => {
    originalLanguage = getCurrentLanguage()
    originalTone = useSettingsStore.getState().themeTonePreset
    originalAutoInsertTextDisplay = useSettingsStore.getState().autoInsertTextDisplayNode
  })

  afterEach(() => {
    changeLanguage(originalLanguage)
    useSettingsStore.getState().setThemeTonePreset(originalTone)
    useSettingsStore.getState().setAutoInsertTextDisplayNode(originalAutoInsertTextDisplay)
  })

  function context(requestId: string) {
    return {
      signal: new AbortController().signal,
      requestId,
      expectedRevisions: { settings: getSettingsRegistryRevision() },
    }
  }

  async function change(id: string, value: string | boolean): Promise<void> {
    await applicationReflectionHandlers.changeEntities({
      summary: `修改 ${id}`,
      changes: [{
        kind: 'set_properties',
        target: { kind: 'settings.registry', id: 'singleton' },
        entityType: 'settings.registry',
        properties: { [id]: value },
      }],
    }, context(`settings-${id}`))
  }

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
})
