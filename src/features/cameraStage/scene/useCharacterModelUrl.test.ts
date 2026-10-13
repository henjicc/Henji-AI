// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveUrl = vi.hoisted(() => vi.fn())
vi.mock('@/platform/desktopApi', () => ({ getBundledResourceUrl: resolveUrl }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))

beforeEach(() => {
  vi.resetModules()
  resolveUrl.mockReset()
})

describe('镜头参考内置模型地址', () => {
  it.each(['useCharacterModelUrl', 'useCameraModelUrl'] as const)('%s 失败后再次挂载重试，成功后命中缓存', async (hookName) => {
    resolveUrl.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValue('henji-media://model.glb')
    const hooks = await import('./useCharacterModelUrl')
    const first = renderHook(hooks[hookName])
    await waitFor(() => expect(resolveUrl).toHaveBeenCalledTimes(1))
    first.unmount()
    const retry = renderHook(hooks[hookName])
    await waitFor(() => expect(retry.result.current).toBe('henji-media://model.glb'))
    retry.unmount()
    const cached = renderHook(hooks[hookName])
    expect(cached.result.current).toBe('henji-media://model.glb')
    expect(resolveUrl).toHaveBeenCalledTimes(2)
    cached.unmount()
  })
})
