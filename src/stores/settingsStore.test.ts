/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './settingsStore'

describe('设置迁移', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      assetEdgeTriggerEnabled: false,
      assetTriggerEdge: 'right',
      assetEdgeDelayMs: 650,
      assetDragEdgeDelayMs: 180,
    })
  })

  it('把旧版本自动启用且未调整过的边缘唤起改为关闭', async () => {
    localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        assetEdgeTriggerEnabled: true,
        assetTriggerEdge: 'right',
        assetEdgeDelayMs: 650,
        assetDragEdgeDelayMs: 180,
      },
      version: 10,
    }))

    await useSettingsStore.persist.rehydrate()

    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(false)
  })

  it('保留用户调整过参数的边缘唤起设置', async () => {
    localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        assetEdgeTriggerEnabled: true,
        assetTriggerEdge: 'left',
        assetEdgeDelayMs: 900,
        assetDragEdgeDelayMs: 180,
      },
      version: 10,
    }))

    await useSettingsStore.persist.rehydrate()

    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(true)
    expect(useSettingsStore.getState().assetTriggerEdge).toBe('left')
    expect(useSettingsStore.getState().assetEdgeDelayMs).toBe(900)
  })

  it('保留 v11 中用户显式开启的边缘唤起设置', async () => {
    localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        assetEdgeTriggerEnabled: true,
        assetTriggerEdge: 'right',
        assetEdgeDelayMs: 650,
        assetDragEdgeDelayMs: 180,
      },
      version: 11,
    }))

    await useSettingsStore.persist.rehydrate()

    expect(useSettingsStore.getState().assetEdgeTriggerEnabled).toBe(true)
  })
})
