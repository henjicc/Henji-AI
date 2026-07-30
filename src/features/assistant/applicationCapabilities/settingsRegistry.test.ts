import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from '@/stores/settingsStore'

import {
  applyApplicationSettingsChange,
  getApplicationSettings,
  planApplicationSettingsChange,
  searchApplicationSettings,
} from './settingsRegistry'

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
})
