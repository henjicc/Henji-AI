import { describe, expect, it, vi } from 'vitest'
import type { AudioCaptureEvent } from '../../../../src/core/audioCapture/contracts'
type Loss = { code: string; message: string }
const native = vi.hoisted(() => ({ request: vi.fn(), event: undefined as ((event: AudioCaptureEvent) => void) | undefined, crash: undefined as ((loss: { code: string; message: string }) => void) | undefined }))
vi.mock('./client', () => ({ AudioCaptureClient: class { constructor(_path: unknown, event: (event: AudioCaptureEvent) => void, crash: (loss: Loss) => void) { native.event = event; native.crash = crash } request = native.request; setActive(): void {} async settled(): Promise<void> {} async dispose(): Promise<void> {} } }))
/** 客户端在应答超时时的真实顺序：先同步走崩溃回调收拢状态，再让这次请求以超时失败。 */
const notResponding = async (): Promise<never> => { native.crash!({ code: 'NOT_RESPONDING', message: '录音服务没有应答' }); throw new AudioCaptureError('TIMEOUT', '录音驱动响应超时') }
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
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
    return { sessionId: last?.sessionId ?? '', outputPath: last?.outputPath ?? '', state, sampleRate: 48000, inputLatency: .01, callbackFrames: 480, frames: 480, writtenBytes: 1440, durationSeconds: .01 }
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
