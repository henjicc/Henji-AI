// @vitest-environment jsdom
import { afterEach, expect, it, vi, type Mock } from 'vitest'
import { RecordingTracksSession } from './session'
import { RecordingTracksClock } from './clock'
import type { TrackDeviceCallbacks } from './devices'
import type { CapturedAudioBlock } from '@/features/creativeIntent/recording/microphone'
import type { RecordingTrackKind, RecordingTrackSegment } from '@/core/screenRecording/tracks'
import type { TrackOutput } from './output'

const platform = vi.hoisted(() => ({ mkdir: vi.fn(async () => {}), write: vi.fn(async (_path: string, _text: string) => {}), status: vi.fn(async (_id: string, _status: { warnings: string[] }) => {}) }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ system: { fs: { mkdir: platform.mkdir, writeTextFile: platform.write }, paths: { join: async (...parts: string[]) => parts.join('/') } }, screenRecording: { trackStatus: platform.status, permissions: async () => [] } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function setup(options: { silentRisk?: boolean; failWrite?: boolean; gate?: Promise<void>; camera?: boolean } = {}) {
  let now = 0
  const clock = new RecordingTracksClock(0, async () => 0, () => {})
  vi.spyOn(clock, 'start').mockResolvedValue(); vi.spyOn(clock, 'nowUs').mockImplementation(() => now)
  const callbacks = new Map<RecordingTrackKind, TrackDeviceCallbacks>()
  const stops: Array<Mock<[], Promise<void>>> = []
  const closes = new Map<RecordingTrackKind, number>()
  const audio: CapturedAudioBlock[] = []
  const failed = vi.fn()
  const output = (_kind: RecordingTrackKind, _directory: string, _fps: number, sealed: (segment: RecordingTrackSegment) => Promise<void>): TrackOutput => {
    let pending: RecordingTrackSegment | undefined
    return { audio: async block => {
      if (options.failWrite) throw new Error('disk-full')
      if (options.gate) await options.gate
      audio.push(block)
      pending ??= { id: crypto.randomUUID(), file: `${crypto.randomUUID()}.wav`, monoSpanUs: [block.monoStartUs, block.monoStartUs], sampleRate: block.sampleRate, channels: block.channels, units: 0, latencyCompensationUs: 0, anchors: [{ monoUs: block.monoStartUs, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 0 }] }
      pending.units += block.samples.length / (block.channels ?? 1); pending.monoSpanUs[1] = block.monoStartUs + block.samples.length / (block.channels ?? 1) / block.sampleRate * 1_000_000
    }, video: async () => {}, close: async () => { closes.set(_kind, (closes.get(_kind) ?? 0) + 1); if (pending) { await sealed(pending); pending = undefined } }, cancel: async () => {} }
  }
  vi.stubGlobal('navigator', { mediaDevices: new EventTarget() })
  const session = new RecordingTracksSession({ sessionId: crypto.randomUUID(), originUs: 0, directory: 'isolated', tracks: { microphone: {}, systemAudio: true, ...(options.camera ? { camera: { width: 640, height: 480, frameRate: 30 } } : {}) }, onFailure: failed }, {
    clock, output, silentRisk: options.silentRisk,
    openDevice: async (kind, _options, _clock, callback) => { callbacks.set(kind, callback); const stop = vi.fn(async () => {}); stops.push(stop); return { stop } },
  })
  const send = (kind: RecordingTrackKind, start: number, firstFrame = start / 1000 * 48, samples = new Float32Array(4800).fill(.2)): void => {
    callbacks.get(kind)!.audio({ monoStartUs: start, firstFrame, samples, sampleRate: 48000, uncertaintyUs: 0, channels: 1 })
  }
  return { session, callbacks, stops, closes, audio, failed, send, now: (value: number) => { now = value }, tick: async () => { for (let i = 0; i < 25; i++) await Promise.resolve() } }
}
it('摄像头缺帧只记真实空档，不能每次重启编码器而制造更多丢帧', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,YWJj')
  const f = setup({ camera: true }); const signal = new AbortController().signal
  await f.session.start(signal)
  const frame = { displayWidth: 640, displayHeight: 480, duration: 33333 } as VideoFrame
  await f.callbacks.get('camera')!.video(frame, 0, 0, 0)
  await f.callbacks.get('camera')!.video(frame, 100_000, 0, 0)
  expect(f.closes.get('camera') ?? 0).toBe(0)
  expect(f.session.snapshot().tracks[2].gaps).toEqual([{ monoSpanUs: [33_333, 100_000], reason: 'missing-data' }])
  await f.session.stop(signal)
  expect(f.closes.get('camera')).toBe(1)
})
it('麦克风与系统声分轨，暂停丢弃期间数据；重开保留真实空档，不补静音', async () => {
  const f = setup(); const signal = new AbortController().signal
  await f.session.start(signal)
  f.send('microphone', 100_000); f.send('systemAudio', 200_000); await f.tick()
  f.now(1_000_000); await f.session.pause(signal)
  f.send('microphone', 2_000_000); await f.tick()
  expect(f.audio).toHaveLength(2)
  f.now(3_000_000); await f.session.resume(signal)
  f.send('microphone', 3_010_000); f.send('systemAudio', 3_020_000); await f.tick()
  await f.session.stop(signal)
  const result = f.session.snapshot()
  expect(result.tracks[0].segments.map(segment => segment.monoSpanUs[0])).toEqual([100_000, 3_010_000])
  expect(result.tracks[0].gaps).toEqual([{ monoSpanUs: [200_000, 3_010_000], reason: 'pause' }])
  expect(f.stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
  expect(JSON.parse(platform.write.mock.calls[0][1] as string)).toEqual(result)
})
it('设备断开仅停对应轨，恢复与声卡缺样本各记空档；其他轨继续', async () => {
  const f = setup(); const signal = new AbortController().signal
  await f.session.start(signal); f.send('microphone', 100_000); await f.tick()
  f.callbacks.get('microphone')!.state('ended'); await f.tick()
  f.send('systemAudio', 1_000_000); await f.tick(); expect(f.audio).toHaveLength(2)
  navigator.mediaDevices.dispatchEvent(new Event('devicechange')); await f.tick()
  f.send('microphone', 2_000_000); await f.tick()
  f.send('microphone', 3_000_000); await f.tick()
  f.now(4_000_000); await f.session.stop(signal)
  expect(f.session.snapshot().tracks[0].gaps).toEqual([{ monoSpanUs: [200_000, 2_000_000], reason: 'device' }, { monoSpanUs: [2_100_000, 3_000_000], reason: 'missing-data' }])
})
it('已知平台风险的持续哑轨只警告一次；有声音与非风险平台不误报', async () => {
  const f = setup({ silentRisk: true }); const signal = new AbortController().signal
  await f.session.start(signal)
  for (let i = 0; i < 51; i++) f.send('systemAudio', i * 100_000, i * 4800, new Float32Array(4800))
  await f.tick(); f.now(6_000_000); f.send('systemAudio', 5_100_000, 51 * 4800); await f.tick()
  expect(platform.status.mock.calls.at(-1)?.[1].warnings).toEqual([])
  await f.session.stop(signal)
  expect(f.session.snapshot().tracks[1].warnings).toEqual(['system-audio-silent'])
})
it('真实写盘拒绝触发一次失败并释放所有设备，不能保存成功清单', async () => {
  const f = setup({ failWrite: true }); await f.session.start(new AbortController().signal)
  f.send('microphone', 0); await f.tick()
  await expect(f.session.cancel()).rejects.toThrow('disk-full')
  expect(f.failed).toHaveBeenCalledTimes(1); expect(f.stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
  expect(platform.write).not.toHaveBeenCalled()
})
it('停止后迟到的预览状态拒绝不污染已保存会话或触发第二次采集失败', async () => {
  let reject!: (error: Error) => void
  platform.status.mockImplementationOnce(() => new Promise<void>((_resolve, rejected) => { reject = rejected }))
  const f = setup(); const signal = new AbortController().signal
  await f.session.start(signal); f.send('microphone', 100_000); await f.tick(); await f.session.stop(signal)
  reject(new Error('owner-closed')); await f.tick()
  expect(f.failed).not.toHaveBeenCalled(); expect(platform.write).toHaveBeenCalledTimes(1)
})
it('背压超出4MiB立即拒绝并取消，未执行的排队样本不再写入', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  const f = setup({ gate }); await f.session.start(new AbortController().signal)
  f.send('microphone', 0, 0, new Float32Array(600_000)); await Promise.resolve()
  f.send('microphone', 12_500_000, 600_000, new Float32Array(600_000))
  expect(f.failed).toHaveBeenCalledTimes(1)
  release(); await f.tick(); await expect(f.session.cancel()).rejects.toThrow('写入跟不上')
  expect(f.audio.length).toBeLessThanOrEqual(1); expect(f.stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
})
it('取消等待中的设备启动，迟到设备立刻释放，所有轨停止后才完成屏障', async () => {
  const f = setup(); let resolve!: (device: { stop(): Promise<void> }) => void; const stop = vi.fn(async () => {})
  const clock = new RecordingTracksClock(0, async () => 0, () => {})
  vi.spyOn(clock, 'start').mockResolvedValue()
  const session = new RecordingTracksSession({ sessionId: crypto.randomUUID(), originUs: 0, directory: 'isolated', tracks: { microphone: {}, systemAudio: false }, onFailure: f.failed }, { clock, openDevice: async () => new Promise(value => { resolve = value }), output: () => ({ audio: async () => {}, video: async () => {}, close: async () => {}, cancel: async () => {} }) })
  const start = session.start(new AbortController().signal); const caught = start.catch(error => error)
  await f.tick(); const cancel = session.cancel(); const canceled = cancel.catch(error => error)
  resolve({ stop }); await caught; await canceled
  expect(stop).toHaveBeenCalledTimes(1)
  expect(f.failed).not.toHaveBeenCalled()
})
