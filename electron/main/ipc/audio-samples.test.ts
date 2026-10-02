import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
type Handler = (input: unknown, event: IpcMainInvokeEvent) => unknown
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), appEvents: new Map<string, () => void>(), range: vi.fn(), legacy: vi.fn(), allowed: vi.fn(), realpath: vi.fn(), trusted: vi.fn(), dispose: vi.fn(), validate: vi.fn() }))
vi.mock('electron', () => ({ app: { once: (event: string, callback: () => void) => mocks.appEvents.set(event, callback) } }))
vi.mock('node:fs/promises', () => ({ default: { realpath: mocks.realpath } }))
vi.mock('../protocol', () => ({ isPathWithinAllowedMediaRoots: mocks.allowed }))
vi.mock('../services/image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../services/audio/ops', () => ({ extractAudioSamples: mocks.legacy, extractAudioWaveformRange: mocks.range, disposeAudioWaveformService: mocks.dispose, validateAudioWaveformRange: mocks.validate }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: mocks.trusted }))
vi.mock('./registry', () => ({
  parseRecord: (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object'); return value },
  registerIpcHandler: (channel: string, parse: (value: unknown) => unknown, handler: Handler, guard: (event: IpcMainInvokeEvent) => void) => mocks.handlers.set(channel, (input, event) => { guard(event); return handler(parse(input), event) }),
}))
import { registerAudioSampleHandlers } from './audio-samples'
const payload = { mode: 'range', source: 'D:/allowed/source.wav', startUs: 0, endUs: 100000, channels: 2, bucketCount: 16, requestId: 'same' }
function owner(id: number): { event: IpcMainInvokeEvent; emitter: EventEmitter } {
  const emitter = Object.assign(new EventEmitter(), { id, isDestroyed: () => false })
  return { event: { sender: emitter } as unknown as IpcMainInvokeEvent, emitter }
}
function invoke(channel: string, input: unknown, event: IpcMainInvokeEvent): Promise<unknown> { return Promise.resolve().then(() => mocks.handlers.get(channel)!(input, event)) }
beforeEach(() => {
  vi.resetAllMocks(); mocks.handlers.clear(); mocks.appEvents.clear(); registerAudioSampleHandlers()
  mocks.realpath.mockImplementation(async (source: string) => source)
  mocks.allowed.mockReturnValue(true); mocks.dispose.mockResolvedValue(undefined)
})

describe('waveform IPC ownership and permissions', () => {
  it('scopes cancellation to sender, rejects duplicate IDs, and discards late result after navigation', async () => {
    const a = owner(101); const b = owner(102)
    const signals: AbortSignal[] = []; const finish: Array<(value: unknown) => void> = []
    mocks.range.mockImplementation((_request, signal: AbortSignal) => { signals.push(signal); return new Promise(resolve => finish.push(resolve)) })
    const first = invoke('audio:extractSamples', payload, a.event).catch(error => error)
    const second = invoke('audio:extractSamples', payload, b.event).catch(error => error)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    await expect(invoke('audio:extractSamples', payload, a.event)).rejects.toThrow('仍在进行')
    await invoke('audio:cancelExtractSamples', { requestId: 'same' }, a.event)
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false)
    b.emitter.emit('did-start-navigation', {}, 'file://new', false, true)
    expect(signals[1].aborted).toBe(true)
    finish[0]({ peak: [9] }); finish[1]({ peak: [10] })
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(await second).toMatchObject({ name: 'AbortError' })
    a.emitter.emit('destroyed'); b.emitter.emit('destroyed')
  })
  it('captures cancellation before realpath finishes and keeps a reused sender request isolated from old cleanup', async () => {
    const a = owner(103)
    let resolvePath!: (value: string) => void
    mocks.realpath.mockImplementationOnce(() => new Promise<string>(resolve => { resolvePath = resolve }))
    const first = invoke('audio:extractSamples', payload, a.event).catch(error => error)
    await vi.waitFor(() => expect(mocks.realpath).toHaveBeenCalled())
    await invoke('audio:cancelExtractSamples', { requestId: 'same' }, a.event)
    resolvePath(payload.source)
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(mocks.range).not.toHaveBeenCalled()
    mocks.range.mockResolvedValue({ channels: [] })
    expect(await invoke('audio:extractSamples', payload, a.event)).toEqual({ channels: [] })
    a.emitter.emit('destroyed')
  })
  it('passes the sound stream and single channel of a mapped edit clip through to the waveform service (task 2.6)', async () => {
    const a = owner(105)
    mocks.range.mockResolvedValue({ channels: [] })
    await invoke('audio:extractSamples', { ...payload, requestId: 'mapped', channels: 1, audioStream: 3, audioChannel: 1 }, a.event)
    expect(mocks.range.mock.calls[0][0]).toEqual({ source: payload.source, startUs: 0, endUs: 100000, bucketCount: 16, channels: 1, audioStream: 3, audioChannel: 1 })
    await expect(invoke('audio:extractSamples', { ...payload, requestId: 'unknown', audioTrack: 1 }, a.event)).rejects.toThrow('未知的音频范围字段')
    a.emitter.emit('destroyed')
  })
  it('checks canonical grants and trusted callers, rejects new range remote inputs, and preserves legacy remote routing', async () => {
    const a = owner(104)
    mocks.realpath.mockResolvedValueOnce('D:/outside/linked.wav')
    mocks.allowed.mockImplementation((source: string) => !source.includes('outside'))
    await expect(invoke('audio:extractSamples', payload, a.event)).rejects.toThrow('实际路径')
    for (const source of ['https://example.test/a.wav', 'relative.wav', 'data:audio/wav']) await expect(invoke('audio:extractSamples', { ...payload, source }, a.event)).rejects.toThrow('读取权限')
    expect(mocks.range).not.toHaveBeenCalled()
    mocks.legacy.mockResolvedValue({ peak: [], rms: [], durationSeconds: 1 })
    await invoke('audio:extractSamples', { source: 'https://example.test/a.wav', bucketCount: 96 }, a.event)
    expect(mocks.legacy).toHaveBeenCalledWith('https://example.test/a.wav', 96, expect.any(AbortSignal))
    await expect(invoke('audio:extractSamples', { source: payload.source, bucketCount: 16, startUs: 0 }, a.event)).rejects.toThrow('未知')
    mocks.trusted.mockImplementationOnce(() => { throw new Error('untrusted') })
    await expect(invoke('audio:extractSamples', payload, a.event)).rejects.toThrow('untrusted')
    a.emitter.emit('destroyed')
  })
  it('aborts destroyed senders and application exit without allowing late successful responses', async () => {
    const a = owner(105)
    let signal!: AbortSignal; let finish!: (value: unknown) => void
    mocks.range.mockImplementation((_request, input: AbortSignal) => { signal = input; return new Promise(resolve => { finish = resolve }) })
    const result = invoke('audio:extractSamples', payload, a.event).catch(error => error)
    await vi.waitFor(() => expect(mocks.range).toHaveBeenCalled())
    a.emitter.emit('destroyed'); expect(signal.aborted).toBe(true)
    mocks.appEvents.get('before-quit')!()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    finish({ channels: [] }); expect(await result).toMatchObject({ name: 'AbortError' })
  })
})
