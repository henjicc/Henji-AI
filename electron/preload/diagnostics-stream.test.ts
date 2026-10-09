import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  invoke: vi.fn(),
  exposed: undefined as unknown,
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: unknown) => { state.exposed = api } },
  webUtils: { getPathForFile: vi.fn() },
  sharedTexture: { setSharedTextureReceiver: vi.fn() },
  ipcRenderer: {
    invoke: state.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const listeners = state.listeners.get(channel) ?? new Set()
      listeners.add(listener)
      state.listeners.set(channel, listeners)
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      state.listeners.get(channel)?.delete(listener)
    },
    postMessage: vi.fn(),
  },
}))

import type { HenjiNativeApi } from './api'

describe('diagnostics stream listener ownership', () => {
  beforeEach(async () => {
    vi.resetModules()
    state.listeners.clear()
    state.invoke.mockReset()
    await import('./index')
  })
  afterEach(() => { vi.restoreAllMocks() })

  it.each(['transport', 'envelope'])('启动失败释放 listener 并保留 %s 错误', async mode => {
    const failure = new Error('stream start failed')
    if (mode === 'transport') state.invoke.mockRejectedValue(failure)
    else state.invoke.mockResolvedValue({ ok: false, error: { name: 'Error', message: failure.message } })
    const api = state.exposed as HenjiNativeApi
    await expect(api.diagnostics.streamEcho('echo', vi.fn())).rejects.toThrow(failure.message)
    expect(state.listeners.get('diagnostics:streamEcho:event')?.size).toBe(0)
  })

  it('订阅早于 invoke，成功后仅交付本流事件，取消失败也先释放 listener', async () => {
    const onEvent = vi.fn()
    state.invoke.mockImplementation(async (_channel: string, payload: { streamId: string }) => {
      expect(state.listeners.get('diagnostics:streamEcho:event')?.size).toBe(1)
      for (const listener of state.listeners.get('diagnostics:streamEcho:event') ?? []) {
        listener({}, { streamId: 'other', message: 'ignore' })
        listener({}, { streamId: payload.streamId, message: 'echo' })
      }
      return { ok: true, data: undefined }
    })
    const api = state.exposed as HenjiNativeApi
    const dispose = await api.diagnostics.streamEcho('echo', onEvent)
    expect(onEvent).toHaveBeenCalledTimes(1)
    state.invoke.mockRejectedValue(new Error('cancel failed'))
    await expect(dispose()).rejects.toThrow('cancel failed')
    expect(state.listeners.get('diagnostics:streamEcho:event')?.size).toBe(0)
  })
})
