/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './settingsStore'
import { SETTINGS_STORAGE_VERSION } from '@/core/persistence/settingsSchema'
import settingsV14 from '../../tests/fixtures/persistence/settings/v14.json'

describe('设置格式保护', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ assetEdgeTriggerEnabled: false, assetTriggerEdge: 'right', assetEdgeDelayMs: 650 })
  })
  it('当前版本黄金样本 hydration 原样保留设置，随后修改按当前版本保存', async () => {
    const text = JSON.stringify(settingsV14)
    localStorage.setItem('settings-storage', text)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState()).toMatchObject(settingsV14.state)
    expect(localStorage.getItem('settings-storage')).toBe(text)
    useSettingsStore.getState().setAssetEdgeTriggerEnabled(true)
    expect(JSON.parse(localStorage.getItem('settings-storage')!)).toMatchObject({ version: SETTINGS_STORAGE_VERSION, state: { ...settingsV14.state, assetEdgeTriggerEnabled: true } })
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(true)
  })
  it('已明确放弃的旧设置不自动迁移、不覆盖原件，后续写入也明确失败', async () => {
    const text = JSON.stringify({ version: 10, state: { assetEdgeTriggerEnabled: true, assetTriggerEdge: 'left', assetEdgeDelayMs: 900 } })
    localStorage.setItem('settings-storage', text)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(false)
    expect(localStorage.getItem('settings-storage')).toBe(text)
    expect(() => useSettingsStore.getState().setAssetEdgeTriggerEnabled(true)).toThrow('早于当前版本可读取的最低版本')
    expect(localStorage.getItem('settings-storage')).toBe(text)
  })
  it('当前版本保留用户设置，hydration不触发改写', async () => {
    const text = JSON.stringify({ version: SETTINGS_STORAGE_VERSION, state: { assetEdgeTriggerEnabled: true, assetTriggerEdge: 'left', assetEdgeDelayMs: 900 } })
    localStorage.setItem('settings-storage', text)
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState()).toMatchObject({ assetEdgeTriggerEnabled: true, assetTriggerEdge: 'left', assetEdgeDelayMs: 900 })
    expect(localStorage.getItem('settings-storage')).toBe(text)
  })
  it('更新版本与损坏JSON都保留原件，不套用当前内容', async () => {
    for (const text of ['{broken', JSON.stringify({ version: SETTINGS_STORAGE_VERSION + 1, state: {} })]) {
      localStorage.setItem('settings-storage', text)
      await useSettingsStore.persist.rehydrate()
      expect(localStorage.getItem('settings-storage')).toBe(text)
      expect(() => useSettingsStore.getState().setAssetEdgeTriggerEnabled(true)).toThrow()
    }
  })
})
