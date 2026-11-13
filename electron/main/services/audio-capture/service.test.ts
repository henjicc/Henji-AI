import { describe, expect, it, vi } from 'vitest'
import type { AudioCaptureEvent } from '../../../../src/core/audioCapture/contracts'
type Loss = { code: string; message: string }
const native = vi.hoisted(() => ({ request: vi.fn(), event: undefined as ((event: AudioCaptureEvent) => void) | undefined, crash: undefined as ((loss: { code: string; message: string }) => void) | undefined }))
vi.mock('./client', () => ({ mainClockUs: () => Number(process.hrtime.bigint() / 1000n), AudioCaptureClient: class { constructor(_path: unknown, event: (event: AudioCaptureEvent) => void, crash: (loss: Loss) => void) { native.event = event; native.crash = crash } request = native.request; setActive(): void {} async settled(): Promise<void> {} async dispose(): Promise<void> {} } }))
/** 客户端在应答超时时的真实顺序：先同步走崩溃回调收拢状态，再让这次请求以超时失败。 */
const notResponding = async (): Promise<never> => { native.crash!({ code: 'NOT_RESPONDING', message: '录音服务没有应答' }); throw new AudioCaptureError('TIMEOUT', '录音驱动响应超时') }
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) }))
vi.mock('../settings/store', () => ({ getSettingsStore: vi.fn() }))
import { AudioCaptureService, PREVIEW_DROP_LAG, SHARED_DROP_LAG } from './service'
import { AudioCaptureSettingsService } from './settings'
import { AudioCaptureError } from './protocol'

const inventory = { hostApis: [], defaultInputDevice: 0, asioCompiled: false, devices: [{ index: 0, hostApi: 'MME', name: '麦克风', maxInputChannels: 2, maxOutputChannels: 0, defaultSampleRate: 48000, defaultLowInputLatency: .01, defaultHighInputLatency: .1, defaultLowOutputLatency: 0, defaultHighOutputLatency: 0, asioBuffers: null }] }
/** 原生替身：记录每次开始的会话与文件，按最近一次开始回答状态。 */
function fakeNative() {
  const starts: { sessionId: string; outputPath: string }[] = []
  let state = 'recording'
  native.request.mockReset()
  native.request.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
    if (type === 'enumerate') return inventory
    if (type === 'start') { starts.push({ sessionId: payload.sessionId as string, outputPath: payload.outputPath as string }); state = 'recording' }
    if (type === 'pause') state = 'paused'
    if (type === 'resume') state = 'recording'
    if (type === 'stop') state = 'stopped'
    const last = starts.at(-1)
    return { sessionId: last?.sessionId ?? '', outputPath: last?.outputPath ?? '', state, sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01, device: '麦克风', channels: 1, joined: false }
  })
  const calls = (type: string): number => native.request.mock.calls.filter(call => call[0] === type).length
  const send = (sequence: number, sessionId = starts.at(-1)!.sessionId): void => native.event!({ event: 'samples', sessionId, sequence, firstFrame: sequence * 480, frames: 1, channels: 1, sampleRate: 48000, monoUs: sequence * 10000, nativeMonoUs: sequence * 10000, uncertaintyUs: 1, format: 'float32le', pcm: new Uint8Array(4) })
  return { starts, calls, send }
}
function createService(hooks = {}) {
  const publish = vi.fn()
  const service = new AudioCaptureService(() => 'native', new AudioCaptureSettingsService(() => ({ get: () => null, set: () => {} })), publish, hooks)
  const published = (owner: number, event: string) => publish.mock.calls.filter(call => call[0] === owner && call[1].event === event).map(call => call[1])
  return { service, publish, published }
}

describe('录音会话归属与队列', () => {
  it('并发开始只有首位成功，其他窗口不可停止；关闭所属窗口保存并停止', async () => {
    const { calls } = fakeNative()
    const { service } = createService()
    const results = await Promise.allSettled([service.run(() => service.start(1, { outputPath: 'C:/Temp/a.wav' })), service.run(() => service.start(2, { outputPath: 'C:/Temp/b.wav' }))])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    const sessionId = (results[0] as PromiseFulfilledResult<{ sessionId: string }>).value.sessionId
    await expect(service.control(2, 'stop', sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    await service.releaseOwner(1)
    expect(calls('start')).toBe(1)
    expect(calls('stop')).toBe(1)
    await expect(service.control(1, 'resume', sessionId)).rejects.toThrow()
    service.dispose()
  })

  it('界面不确认采样时只暂停推送，录音不停；确认后接着推送', async () => {
    const { calls, send } = fakeNative()
    const { service, published } = createService()
    const { sessionId } = await service.run(() => service.start(1, { outputPath: 'C:/Temp/slow.wav', streamSamples: true }))
    for (let sequence = 0; sequence < 3000; sequence++) send(sequence)
    await service.run(async () => {})
    expect(published(1, 'interrupted')).toHaveLength(0)
    expect(calls('stop')).toBe(0)
    const sent = published(1, 'samples').map(event => event.sequence)
    // 跟不上之后只隔一段发一块探测，没有把三千块都推过去。
    expect(sent.length).toBeGreaterThan(PREVIEW_DROP_LAG)
    expect(sent.length).toBeLessThan(PREVIEW_DROP_LAG + 60)
    service.acknowledge(1, sessionId, sent.at(-1)!)
    send(3000); send(3001)
    expect(published(1, 'samples').map(event => event.sequence).slice(-2)).toEqual([3000, 3001])
    await service.control(1, 'stop', sessionId)
    service.dispose()
  })

  it('界面重载时录音继续；查询应答后紧跟着中断时，不把已结束的录音交给新界面', async () => {
    const { calls, send } = fakeNative()
    const hold = vi.fn(), release = vi.fn()
    hold.mockReturnValue(release)
    const { service } = createService({ holdWakeLock: hold })
    const { sessionId } = await service.run(() => service.start(1, { outputPath: 'C:/Temp/long.wav', streamSamples: true }))
    expect(hold).toHaveBeenCalledOnce()
    for (let sequence = 0; sequence < 1500; sequence++) send(sequence)
    await service.releaseOwner(1, { keepRecording: true })
    expect(calls('stop')).toBe(0)
    expect(await service.activeRecording(2)).toBeNull()
    // 查询应答之后紧跟着中断（同一段管道数据里先后到达）：不能把已结束的录音交给新界面。
    native.request.mockImplementationOnce(async () => {
      queueMicrotask(() => native.event!({ event: 'interrupted', sessionId, outputPath: 'C:/Temp/long.wav', writtenBytes: 1440, error: { code: 'DEVICE_REMOVED', message: '设备已停止提供采样', recoverable: true } }))
      return { sessionId, outputPath: 'C:/Temp/long.wav', state: 'recording', sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01 }
    })
    expect(await service.activeRecording(1)).toBeNull()
    expect(release).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('界面重载后新界面接管：确认重新计，窗口关闭才停止', async () => {
    const { calls, send } = fakeNative()
    const release = vi.fn()
    const { service, published } = createService({ holdWakeLock: () => release })
    const { sessionId } = await service.run(() => service.start(1, { outputPath: 'C:/Temp/long.wav', streamSamples: true }))
    for (let sequence = 0; sequence < 1500; sequence++) send(sequence)
    await service.releaseOwner(1, { keepRecording: true })
    const adopted = await service.activeRecording(1)
    expect(adopted).toMatchObject({ sessionId, state: 'recording', outputPath: 'C:/Temp/long.wav' })
    const before = published(1, 'samples').length
    send(1500)
    expect(published(1, 'samples')).toHaveLength(before + 1)
    expect(release).not.toHaveBeenCalled()
    await service.releaseOwner(1)
    expect(calls('stop')).toBe(1)
    expect(release).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('停止迟迟不应答：录音服务被结束后状态收拢，睡眠阻止已释放、文件可恢复、可以重新开始', async () => {
    const { calls } = fakeNative()
    const release = vi.fn()
    const { service, published } = createService({ holdWakeLock: () => release, interrupted: vi.fn() })
    const first = await service.run(() => service.start(1, { outputPath: 'C:/Temp/hang.wav', streamSamples: true }))
    native.request.mockImplementationOnce(notResponding)
    await expect(service.run(() => service.control(1, 'stop', first.sessionId))).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(published(1, 'interrupted')).toEqual([expect.objectContaining({ sessionId: first.sessionId, error: expect.objectContaining({ code: 'NOT_RESPONDING' }) })])
    expect(release).toHaveBeenCalledOnce()
    expect(service.isRecordingPath('C:/Temp/hang.wav')).toBe(false)
    await expect(service.run(() => service.recover('C:/Temp/hang.wav'))).resolves.toEqual({ writtenBytes: 1440 })
    const next = await service.run(() => service.start(1, { outputPath: 'C:/Temp/next.wav', streamSamples: true }))
    expect(next.sessionId).not.toBe(first.sessionId)
    expect(calls('start')).toBe(2)
    await service.control(1, 'stop', next.sessionId)
    void service.dispose()
  })

  it('音频编辑录音被设备中断：通知所属窗口并释放睡眠阻止', async () => {
    fakeNative()
    const release = vi.fn(), interrupted = vi.fn()
    const { service, published } = createService({ holdWakeLock: () => release, interrupted })
    const { sessionId, outputPath } = await service.run(() => service.start(1, { outputPath: 'C:/Temp/cut.wav', streamSamples: true }))
    native.event!({ event: 'interrupted', sessionId, outputPath, writtenBytes: 2880, error: { code: 'DEVICE_REMOVED', message: '设备已停止提供采样', recoverable: true } })
    expect(published(1, 'interrupted')).toEqual([expect.objectContaining({ sessionId, writtenBytes: 2880 })])
    expect(interrupted).toHaveBeenCalledWith(1, expect.objectContaining({ error: expect.objectContaining({ code: 'DEVICE_REMOVED' }) }))
    expect(release).toHaveBeenCalledOnce()
    expect(await service.activeRecording(1)).toBeNull()
    service.dispose()
  })
})

it('录屏与讲解共享一次设备采集，暂停/停止/窗口释放只影响各自订阅', async () => {
  const { calls, send } = fakeNative()
  const { service, publish } = createService()
  const a = await service.run(() => service.start(1, { outputPath: '/temp/a.wav', shared: true, streamSamples: true }))
  const b = await service.run(() => service.start(2, { outputPath: '/temp/b.wav', shared: true, streamSamples: true }))
  expect(a.sessionId).not.toBe(b.sessionId)
  expect(calls('start')).toBe(1)
  send(500)
  expect(publish).toHaveBeenCalledWith(1, expect.objectContaining({ sessionId: a.sessionId, monoUs: 5000000 }))
  expect(publish).toHaveBeenCalledWith(2, expect.objectContaining({ sessionId: b.sessionId, monoUs: 5000000 }))
  service.acknowledge(1, a.sessionId, 500); service.acknowledge(2, b.sessionId, 500)
  await expect(service.control(2, 'stop', a.sessionId)).rejects.toThrow('当前窗口')
  await service.control(1, 'pause', a.sessionId)
  expect(calls('pause')).toBe(0)
  publish.mockClear(); send(501)
  expect(publish.mock.calls.map(call => call[0])).toEqual([2])
  const stopped = await service.control(2, 'stop', b.sessionId)
  expect(stopped.sharedSubscribers).toBe(1)
  expect(calls('pause')).toBe(1)
  await service.control(1, 'resume', a.sessionId)
  expect(calls('resume')).toBe(1)
  await service.releaseOwner(2)
  expect(calls('stop')).toBe(0)
  // 麦克风订阅由界面写分段，界面重载后失去归属：即使保留录音也要结束它。
  await service.releaseOwner(1, { keepRecording: true })
  expect(calls('stop')).toBe(1)
  const slow = await service.start(3, { outputPath: '/temp/slow.wav', shared: true, streamSamples: true })
  const fast = await service.start(4, { outputPath: '/temp/fast.wav', shared: true, streamSamples: true })
  publish.mockClear()
  // 共享麦克风的推送就是录屏轨道，比只画波形的独占录音多等很久才开始丢。
  for (let sequence = 700; sequence < 700 + SHARED_DROP_LAG + 200; sequence++) { send(sequence); service.acknowledge(4, fast.sessionId, sequence) }
  await service.run(async () => {})
  expect(publish).not.toHaveBeenCalledWith(3, expect.objectContaining({ event: 'interrupted' }))
  const slowSent = publish.mock.calls.filter(call => call[0] === 3 && call[1].event === 'samples').length
  expect(slowSent).toBeGreaterThanOrEqual(SHARED_DROP_LAG)
  expect(slowSent).toBeLessThan(SHARED_DROP_LAG + 10)
  expect(publish.mock.calls.filter(call => call[0] === 4 && call[1].event === 'samples')).toHaveLength(SHARED_DROP_LAG + 200)
  expect(calls('stop')).toBe(1)
  await service.control(3, 'stop', slow.sessionId)
  expect(await service.control(4, 'stop', fast.sessionId)).toMatchObject({ sharedSubscribers: 0 })
  service.dispose()
})

it('共享麦克风停止应答超时：订阅照样移除，不再重连，睡眠阻止已释放，之后还能重新开始', async () => {
  vi.useFakeTimers()
  try {
    const { starts } = fakeNative()
    const release = vi.fn()
    const { service, publish } = createService({ holdWakeLock: () => release })
    const screen = await service.run(() => service.start(7, { outputPath: '/temp/mic.wav', shared: true, streamSamples: true }))
    native.request.mockImplementationOnce(notResponding)
    await expect(service.run(() => service.control(7, 'stop', screen.sessionId))).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(release).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    await service.run(async () => {})
    expect(starts).toHaveLength(1)
    expect(publish).not.toHaveBeenCalledWith(7, expect.objectContaining({ event: 'interrupted' }))
    await expect(service.control(7, 'status', screen.sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    const next = await service.run(() => service.start(7, { outputPath: '/temp/mic-next.wav', shared: true, streamSamples: true }))
    expect(starts).toHaveLength(2)
    await service.control(7, 'stop', next.sessionId)
    void service.dispose()
  } finally { vi.useRealTimers() }
})

it('共享麦克风中断后自动重连，订阅保留、推送序号继续递增', async () => {
  vi.useFakeTimers()
  try {
    const { starts, send } = fakeNative()
    const { service, publish } = createService()
    const screen = await service.run(() => service.start(7, { outputPath: '/temp/mic.wav', shared: true, streamSamples: true }))
    send(0); send(1)
    native.event!({ event: 'interrupted', sessionId: starts[0].sessionId, outputPath: '/temp/mic.wav', writtenBytes: 960, error: { code: 'DEVICE_REMOVED', message: '设备已停止提供采样', recoverable: true } })
    expect(publish).not.toHaveBeenCalledWith(7, expect.objectContaining({ event: 'interrupted' }))
    expect(await service.control(7, 'status', screen.sessionId)).toMatchObject({ state: 'recording', sharedSubscribers: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await service.run(async () => {})
    expect(starts).toHaveLength(2)
    expect(starts[1].outputPath.replaceAll('\\', '/')).toBe('/temp/mic-2.wav')
    publish.mockClear()
    send(0)
    expect(publish).toHaveBeenCalledWith(7, expect.objectContaining({ event: 'samples', sessionId: screen.sessionId, sequence: 2 }))
    expect(await service.control(7, 'stop', screen.sessionId)).toMatchObject({ sharedSubscribers: 0 })
    service.dispose()
  } finally { vi.useRealTimers() }
})

it('停止时磁盘卡住、原生先应答“还在写”：按可恢复的中断处理，不当成正常完成去拼回不完整的文件', async () => {
  fakeNative()
  const fallback = native.request.getMockImplementation()!
  native.request.mockImplementation(async (type: string, payload?: Record<string, unknown>) => ({ ...await fallback(type, payload), ...(type === 'stop' ? { pending: true } : {}) }))
  const interrupted = vi.fn()
  const { service, published } = createService({ interrupted })
  const take = await service.run(() => service.start(1, { outputPath: 'C:/Temp/take.wav', streamSamples: true }))
  await expect(service.control(1, 'stop', take.sessionId)).rejects.toMatchObject({ code: 'STOP_PENDING' })
  expect(published(1, 'interrupted')).toMatchObject([{ error: { code: 'STOP_PENDING', recoverable: true } }])
  expect(service.recordingState(1)).toMatchObject({ recording: null, interruption: { code: 'STOP_PENDING' } })
  expect(interrupted).toHaveBeenCalledOnce()
  await service.dispose()
})

describe('录屏的麦克风轨', () => {
  const health = { inputOverflows: 0, inputUnderflows: 0, droppedFrames: 0, droppedPreviewBlocks: 0, maxWriteMs: 0, lastGlitchSeconds: 0 }
  /** 原生替身：记下每次开的麦克风轨与它带不带设备设置（不带就是接到已开着的那一路上）。 */
  function fakeTrackNative() {
    const tracks: { sessionId: string; settings: unknown }[] = []
    const files: string[] = []
    native.request.mockReset()
    native.request.mockImplementation(async (type: string, payload: Record<string, unknown> = {}) => {
      if (type === 'enumerate') return inventory
      // 先开的一方开设备，后开的接到同一路上（joined），设备与格式是先开那一方的。
      const joined = tracks.length + files.length > 0
      if (type === 'startMicrophoneTrack') { tracks.push({ sessionId: payload.sessionId as string, settings: payload.settings }); return { sampleRate: 48000, device: '会议麦克风', channels: 2, joined, health } }
      if (type === 'start') files.push(payload.sessionId as string)
      return { sessionId: String(payload.sessionId ?? ''), outputPath: String(payload.outputPath ?? ''), state: type === 'stop' ? 'stopped' : 'recording', sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01, device: '会议麦克风', channels: 2, joined, health }
    })
    const segment = (phase: 'open' | 'seal', sessionId: string, segmentId: string, monoUs: number, frames?: number): void =>
      native.event!({ event: 'segment', sessionId, phase, segmentId, file: `${segmentId}.wav`, firstFrame: 0, sampleRate: 48000, channels: 1, bitDepth: 24, nativeMonoUs: monoUs, monoUs, uncertaintyUs: 2, ...(frames ? { frames } : {}) } as unknown as AudioCaptureEvent)
    return { tracks, files, segment, calls: (type: string): number => native.request.mock.calls.filter(call => call[0] === type).length }
  }

  it('音频编辑在录时开麦克风轨：照样带上设备设置（原生接到同一路时不用），段事件只进轨道，轨道停止不打断音频编辑', async () => {
    const { tracks, files, segment, calls } = fakeTrackNative()
    const { service, published } = createService()
    const take = await service.run(() => service.start(1, { outputPath: 'C:/Temp/take.wav', streamSamples: true }))
    const records: unknown[] = []
    const track = await service.startTrack({ directory: 'C:/Temp/screen', originUs: 0, record: record => records.push(record) })
    expect(files).toEqual([take.sessionId])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].settings).toMatchObject({ device: 0 })
    segment('open', tracks[0].sessionId, '6f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10', 1_000_000)
    expect(records).toMatchObject([{ type: 'open', kind: 'microphone', segment: { monoStartUs: 1_000_000, channels: 1 } }])
    expect(published(1, 'interrupted')).toEqual([])
    await track.stop()
    expect(calls('stop')).toBe(1)
    expect(service.recordingState(1).recording).toMatchObject({ state: 'recording' })
    await service.control(1, 'stop', take.sessionId)
    await service.dispose()
  })

  it('录屏麦克风轨先开、音频编辑后开且设置不同：回执里的设置与提示写实际用的设备与格式', async () => {
    fakeTrackNative()
    const { service } = createService()
    const track = await service.startTrack({ directory: 'C:/Temp/screen', originUs: 0, record: () => {} })
    const take = await service.run(() => service.start(1, { outputPath: 'C:/Temp/take.wav', streamSamples: true }))
    expect(take.settings).toMatchObject({ deviceName: '会议麦克风', channels: 2, sampleRate: 48000 })
    expect(take.notice).toContain('会议麦克风')
    await service.control(1, 'stop', take.sessionId)
    await track.stop()
    await service.dispose()
  })

  it('麦克风设备拔出：从最后录到的一帧起记设备空档，重新枚举后接着录；写盘失败才结束这一路', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { tracks, segment, calls } = fakeTrackNative()
      const { service } = createService()
      const records: Array<{ type: string; gap?: { reason: string; monoSpanUs: number[] } }> = [], available = vi.fn(), failed = vi.fn()
      const track = await service.startTrack({ directory: 'C:/Temp/screen', originUs: 0, record: record => records.push(record), available, failed })
      expect(tracks[0].settings).toMatchObject({ device: 0 })
      segment('open', tracks[0].sessionId, '6f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10', 1_000_000)
      segment('seal', tracks[0].sessionId, '6f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10', 1_000_000, 96_000)
      native.event!({ event: 'interrupted', sessionId: tracks[0].sessionId, outputPath: 'C:/Temp/screen', writtenBytes: 0, error: { code: 'DEVICE_REMOVED', message: '设备已停止提供采样', recoverable: true } })
      expect(available).toHaveBeenLastCalledWith(false)
      const enumerated = calls('enumerate')
      await vi.advanceTimersByTimeAsync(600)
      expect(tracks).toHaveLength(2)
      expect(calls('enumerate')).toBe(enumerated + 1)
      expect(available).toHaveBeenLastCalledWith(true)
      segment('open', tracks[1].sessionId, '7f1f0d2c-0d6b-4b7e-9a1b-4e1f7c2f3a10', 4_500_000)
      expect(records.map(record => record.type === 'gap' ? record.gap!.reason : record.type)).toEqual(['open', 'seal', 'device', 'open'])
      expect(records[2].gap!.monoSpanUs).toEqual([3_000_000, 4_500_000])
      native.event!({ event: 'interrupted', sessionId: tracks[1].sessionId, outputPath: 'C:/Temp/screen', writtenBytes: 0, error: { code: 'DISK_FULL', message: '磁盘空间不足', recoverable: true } })
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ code: 'DISK_FULL' }))
      expect((await track.stop()).outcome).toBe('failed')
      await service.dispose()
    } finally { vi.useRealTimers() }
  })
})
