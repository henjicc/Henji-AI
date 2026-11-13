import { afterEach, expect, it, vi } from 'vitest'

import { assertVideoEditFramesComposable, videoEditFramesComposable } from './videoEditHeadlessGuard'

afterEach(() => { vi.unstubAllGlobals() })

it('无窗口模式在入口拒绝合成画面并说明不是显卡故障，有窗口时放行', () => {
  vi.stubGlobal('window', { henjiNative: { runtimeInfo: { headlessWindow: true } } })
  expect(videoEditFramesComposable()).toBe(false)
  expect(() => assertVideoEditFramesComposable()).toThrow(/无窗口模式.*不是显卡或驱动故障/)
  vi.stubGlobal('window', { henjiNative: { runtimeInfo: { headlessWindow: false } } })
  expect(videoEditFramesComposable()).toBe(true)
  expect(() => assertVideoEditFramesComposable()).not.toThrow()
})
