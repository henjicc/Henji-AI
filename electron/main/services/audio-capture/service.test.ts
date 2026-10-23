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

it('录屏与讲解共享一次设备采集，暂停/停止/窗口释放只影响各自订阅', async () => {
  native.request.mockClear()
  let nativeId = '', state = 'recording'
  native.request.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
    if (type === 'enumerate') return { hostApis: [], defaultInputDevice: 0, asioCompiled: false, devices: [{ index: 0, hostApi: 'MME', name: '麦克风', maxInputChannels: 2, maxOutputChannels: 0, defaultSampleRate: 48000, defaultLowInputLatency: .01, defaultHighInputLatency: .1, defaultLowOutputLatency: 0, defaultHighOutputLatency: 0, asioBuffers: null }] }
    if (type === 'start') nativeId = payload.sessionId as string
    if (type === 'pause') state = 'paused'
    if (type === 'resume') state = 'recording'
    if (type === 'stop') state = 'stopped'
    return { sessionId: nativeId, outputPath: '/temp/shared.wav', state, sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01 }
  })
  const publish = vi.fn(), service = new AudioCaptureService(() => 'native', new AudioCaptureSettingsService(() => ({ get: () => null, set: () => {} })), publish)
  const a = await service.run(() => service.start(1, { outputPath: '/temp/a.wav', shared: true, streamSamples: true }))
  const b = await service.run(() => service.start(2, { outputPath: '/temp/b.wav', shared: true, streamSamples: true }))
  expect(a.sessionId).not.toBe(b.sessionId)
  expect(native.request.mock.calls.filter(c => c[0] === 'start')).toHaveLength(1)
  const send = (sequence: number): void => native.event!({ event: 'samples', sessionId: nativeId, sequence, firstFrame: sequence * 480, frames: 1, channels: 1, sampleRate: 48000, monoUs: sequence * 10000, nativeMonoUs: sequence * 10000, uncertaintyUs: 1, format: 'float32le', pcm: new Uint8Array(4) })
  send(500)
  expect(publish).toHaveBeenCalledWith(1, expect.objectContaining({ sessionId: a.sessionId, monoUs: 5000000 }))
  expect(publish).toHaveBeenCalledWith(2, expect.objectContaining({ sessionId: b.sessionId, monoUs: 5000000 }))
  service.acknowledge(1, a.sessionId, 500); service.acknowledge(2, b.sessionId, 500)
  await expect(service.control(2, 'stop', a.sessionId)).rejects.toThrow('当前窗口')
  await service.control(1, 'pause', a.sessionId)
  expect(native.request.mock.calls.filter(c => c[0] === 'pause')).toHaveLength(0)
  publish.mockClear(); send(501)
  expect(publish.mock.calls.map(call => call[0])).toEqual([2])
  const stopped = await service.control(2, 'stop', b.sessionId)
  expect(stopped.sharedSubscribers).toBe(1)
  expect(native.request.mock.calls.filter(c => c[0] === 'pause')).toHaveLength(1)
  await service.control(1, 'resume', a.sessionId)
  expect(native.request.mock.calls.filter(c => c[0] === 'resume')).toHaveLength(1)
  await service.releaseOwner(2)
  expect(native.request.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(0)
  await service.releaseOwner(1)
  expect(native.request.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(1)
  const slow = await service.start(3, { outputPath: '/temp/slow.wav', shared: true, streamSamples: true })
  const fast = await service.start(4, { outputPath: '/temp/fast.wav', shared: true, streamSamples: true })
  publish.mockClear()
  for (let sequence = 700; sequence < 830; sequence++) { send(sequence); service.acknowledge(4, fast.sessionId, sequence) }
  await service.run(async () => {})
  expect(publish).toHaveBeenCalledWith(3, expect.objectContaining({ event: 'interrupted', sessionId: slow.sessionId, error: expect.objectContaining({ code: 'CONSUMER_TOO_SLOW' }) }))
  expect(publish).not.toHaveBeenCalledWith(4, expect.objectContaining({ event: 'interrupted' }))
  expect(native.request.mock.calls.filter(c => c[0] === 'stop')).toHaveLength(1)
  expect(await service.control(4, 'stop', fast.sessionId)).toMatchObject({ sharedSubscribers: 0 })
  service.dispose()
})
