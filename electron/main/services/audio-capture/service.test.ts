import { describe, expect, it, vi } from 'vitest'
import type { AudioCaptureEvent } from '../../../../src/core/audioCapture/contracts'
const native = vi.hoisted(() => ({ request: vi.fn(), event: undefined as ((event: AudioCaptureEvent) => void) | undefined }))
vi.mock('./client', () => ({ AudioCaptureClient: class { constructor(_path: unknown, event: (event: AudioCaptureEvent) => void) { native.event = event } request = native.request; setActive(): void {} dispose(): void {} } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
vi.mock('../settings/store', () => ({ getSettingsStore: vi.fn() }))
import { AudioCaptureService } from './service'
import { AudioCaptureSettingsService } from './settings'

describe('录音会话归属与队列', () => {
  it('并发开始只有首位成功，其他窗口不可停止；关闭所属窗口保存并停止', async () => {
    let sessionId = ''
    native.request.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
      if (type === 'enumerate') return { hostApis: [], defaultInputDevice: 0, asioCompiled: false, devices: [{ index: 0, hostApi: 'MME', name: '麦克风', maxInputChannels: 1, maxOutputChannels: 0, defaultSampleRate: 48000, defaultLowInputLatency: .01, defaultHighInputLatency: .1, defaultLowOutputLatency: 0, defaultHighOutputLatency: 0, asioBuffers: null }] }
      if (type === 'start') sessionId = payload.sessionId as string
      return { sessionId, outputPath: 'C:/Temp/a.wav', state: type === 'stop' ? 'stopped' : 'recording', sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01 }
    })
    const publish = vi.fn()
    const service = new AudioCaptureService(() => 'native', new AudioCaptureSettingsService(() => ({ get: () => null, set: () => {} })), publish)
    const results = await Promise.allSettled([service.run(() => service.start(1, { outputPath: 'C:/Temp/a.wav' })), service.run(() => service.start(2, { outputPath: 'C:/Temp/b.wav' }))])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    await expect(service.control(2, 'stop', sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    await service.releaseOwner(1)
    expect(native.request.mock.calls.filter(c => c[0] === 'start')).toHaveLength(1)
    expect(native.request.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(1)
    await expect(service.control(1, 'resume', sessionId)).rejects.toThrow()
    await service.run(() => service.start(1, { outputPath: 'C:/Temp/slow.wav', streamSamples: true }))
    for (let sequence = 0; sequence <= 128; sequence++) native.event!({ event: 'samples', sessionId, sequence, firstFrame: sequence, frames: 1, channels: 1, sampleRate: 48000, monoUs: sequence * 21, nativeMonoUs: sequence * 21, uncertaintyUs: 1, format: 'float32le', pcm: new Uint8Array(4) })
    await service.run(async () => {})
    expect(publish).toHaveBeenCalledWith(1, expect.objectContaining({ event: 'interrupted', writtenBytes: 1440, error: expect.objectContaining({ code: 'CONSUMER_TOO_SLOW' }) }))
    expect(native.request.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(2)
    service.dispose()
  })
})
