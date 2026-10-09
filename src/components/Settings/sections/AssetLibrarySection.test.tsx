/** @vitest-environment jsdom */
import { Profiler } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import AssetLibrarySection from './AssetLibrarySection'

afterEach(cleanup)

it('无关设置不会重绘素材库设置，相关设置仍更新', () => {
  const initial = useSettingsStore.getState()
  const commit = vi.fn()
  render(<Profiler id="asset-settings" onRender={commit}><AssetLibrarySection /></Profiler>)
  commit.mockClear()
  act(() => useSettingsStore.setState({ uiScaleMode: initial.uiScaleMode === '125' ? '100' : '125' }))
  expect(commit).not.toHaveBeenCalled()
  act(() => useSettingsStore.setState({ assetEdgeTriggerEnabled: !initial.assetEdgeTriggerEnabled }))
  expect(commit).toHaveBeenCalled()
  act(() => useSettingsStore.setState({ uiScaleMode: initial.uiScaleMode, assetEdgeTriggerEnabled: initial.assetEdgeTriggerEnabled }))
})
