// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { createApplicationHarness } from '@/tests/applicationHarness'

let originalContrast: ReturnType<typeof useSettingsStore.getState>['themeSelection']['contrast']
beforeEach(() => { originalContrast = useSettingsStore.getState().themeSelection.contrast })
afterEach(() => { vi.restoreAllMocks(); useSettingsStore.getState().setThemeContrast(originalContrast) })

it('公共入口完成设置写入、正式读回和实际副作用校验', async () => {
  const app = createApplicationHarness()
  try {
    const next = originalContrast === 'soft' ? 'strong' : 'soft'
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const result = await app.change(ref, { 'interface.theme_contrast': next })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('设置写入失败')
    expect(result.data.effects).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'settings.registry', effect: 'update' })]))
    expect((await app.read(ref, ['interface.theme_contrast'])).properties).toEqual({ 'interface.theme_contrast': next })
    expect(useSettingsStore.getState().themeSelection.contrast).toBe(next)
  } finally { app.dispose() }
})

it('实际设置未改变时，正式读回拒绝把写入报告为成功', async () => {
  const app = createApplicationHarness()
  try {
    vi.spyOn(useSettingsStore.getState(), 'setThemeContrast').mockImplementation(() => {})
    const result = await app.change({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_contrast': originalContrast === 'soft' ? 'strong' : 'soft' })
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(useSettingsStore.getState().themeSelection.contrast).toBe(originalContrast)
  } finally { app.dispose() }
})
