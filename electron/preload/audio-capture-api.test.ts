import { describe, expect, it, vi } from 'vitest'
import { createAudioCaptureApi } from './audio-capture-api'
import { AUDIO_CAPTURE_CHANNEL } from '../../src/platform/contracts/audioCapture'

describe('录音订阅消费确认', () => {
  it('电平监听不能确认未消费的采样，多采样订阅不重复确认', () => {
    const invoke = vi.fn(async (_channel: string, _payload?: unknown): Promise<unknown> => undefined)
    const listeners = new Set<(payload: unknown) => void>()
    const api = createAudioCaptureApi(async <T>(channel: string, payload?: unknown) => await invoke(channel, payload) as T, (_channel, listener) => { listeners.add(listener); return () => { listeners.delete(listener) } })
    const level = vi.fn(), samples = vi.fn()
    const releaseLevel = api.onLevel(level)
    const event = { event: 'samples', sessionId: 'one', sequence: 7 }
    listeners.forEach(listener => listener(event))
    expect(invoke).not.toHaveBeenCalled()
    const releaseSamples = api.onSamples(samples), releaseAll = api.onEvent(() => {})
    listeners.forEach(listener => listener(event))
    expect(samples).toHaveBeenCalledOnce()
    expect(level).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(AUDIO_CAPTURE_CHANNEL, { action: 'ack', sessionId: 'one', sequence: 7 })
    releaseSamples(); releaseAll(); releaseLevel()
    expect(listeners.size).toBe(0)
  })
})
