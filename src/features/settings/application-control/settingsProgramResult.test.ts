// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { createApplicationHarness } from '@/tests/applicationHarness'

let originalTone: ReturnType<typeof useSettingsStore.getState>['themeTonePreset']
beforeEach(() => { originalTone = useSettingsStore.getState().themeTonePreset })
afterEach(() => { vi.restoreAllMocks(); useSettingsStore.getState().setThemeTonePreset(originalTone) })

it('公共入口完成设置写入、正式读回和实际副作用校验', async () => {
  const app = createApplicationHarness()
  try {
    const next = originalTone === 'warm' ? 'cool' : 'warm'
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const result = await app.change(ref, { 'interface.theme_tone': next })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('设置写入失败')
    expect(result.data.effects).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'settings.registry', effect: 'update' })]))
    expect((await app.read(ref, ['interface.theme_tone'])).properties).toEqual({ 'interface.theme_tone': next })
    expect(useSettingsStore.getState().themeTonePreset).toBe(next)
  } finally { app.dispose() }
})

it('实际设置未改变时，正式读回拒绝把写入报告为成功', async () => {
  const app = createApplicationHarness()
  try {
    vi.spyOn(useSettingsStore.getState(), 'setThemeTonePreset').mockImplementation(() => {})
    const result = await app.change({ kind: 'settings.registry', id: 'singleton' }, { 'interface.theme_tone': originalTone === 'warm' ? 'cool' : 'warm' })
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(useSettingsStore.getState().themeTonePreset).toBe(originalTone)
  } finally { app.dispose() }
})
