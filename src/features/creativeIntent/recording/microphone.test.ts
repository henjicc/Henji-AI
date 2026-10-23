import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { captureMicrophone, nativeMicrophoneBlock } from './microphone'
import { DEFAULT_AUDIO_CAPTURE_SETTINGS, type AudioCaptureEvent, type AudioCaptureSamples } from '@/core/audioCapture/contracts'
import { clockAnchorSchema } from '@/core/captureLog/clock'
const fake = vi.hoisted(() => ({ samples: undefined as ((event: AudioCaptureSamples) => void) | undefined, event: undefined as ((event: AudioCaptureEvent) => void) | undefined, start: vi.fn(), stop: vi.fn(), remove: vi.fn(), release: vi.fn() }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ audioCapture: {
  getSettings: async () => ({ effectiveSettings: DEFAULT_AUDIO_CAPTURE_SETTINGS }), clock: async () => ({ mainUs: 1_000_000, uncertaintyUs: 5 }),
  start: fake.start, stop: fake.stop,
  onSamples: (handler: typeof fake.samples) => { fake.samples = handler; return fake.release }, onEvent: (handler: typeof fake.event) => { fake.event = handler; return fake.release },
}, system: { paths: { tempDir: async () => '/temp', join: async (...parts: string[]) => parts.join('/') }, fs: { remove: fake.remove } } }) }))
const status = { sessionId: 'native', outputPath: '/temp/raw.wav', state: 'recording' as const, sampleRate: 48000, settings: DEFAULT_AUDIO_CAPTURE_SETTINGS }
function block(monoUs: number, firstFrame = 0): AudioCaptureSamples { return { event: 'samples', sessionId: 'native', sequence: firstFrame, firstFrame, frames: 2, channels: 2, sampleRate: 48000, monoUs, nativeMonoUs: monoUs, uncertaintyUs: 20, format: 'float32le', pcm: new Uint8Array(new Float32Array([.25, -.5, .3, -.6]).buffer) } }
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(performance, 'now').mockReturnValue(100); fake.start.mockResolvedValue(status); fake.stop.mockResolvedValue({ ...status, state: 'stopped', sharedSubscribers: 0 }) })
afterEach(() => { vi.restoreAllMocks() })
it('按主进程时钟换算并保留真实暂停空隙、原始左右声道及不确定度', () => {
  const first = nativeMicrophoneBlock(block(1_100_000), { originMs: -900, uncertaintyUs: 7 }, 50, 32)
  const next = nativeMicrophoneBlock(block(3_100_000, 2), { originMs: -900, uncertaintyUs: 7 }, 50, 32)
  expect(first).toMatchObject({ monoStartUs: 150000, uncertaintyUs: 27, bitDepth: 32, channels: 2 })
  expect([...first.samples].slice(0, 2)).toEqual([.25, -.5])
  expect(next.monoStartUs - first.monoStartUs).toBe(2_000_000)
})
it('原生漂移的小数微秒向上取整，符合分段清单锚点契约', () => {
  const converted = nativeMicrophoneBlock({ ...block(1_100_000), uncertaintyUs: 20.17 }, { originMs: -900, uncertaintyUs: 7.12 }, 50, 24)
  expect(converted.uncertaintyUs).toBe(28)
  expect(() => clockAnchorSchema.parse({ monoUs: converted.monoStartUs, audioSample: converted.firstFrame, audioSegmentRef: 'segment', audioRate: converted.sampleRate, uncertaintyUs: converted.uncertaintyUs,
    presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0 })).not.toThrow()
})
it('统一设置进入原生共享采集，停止保留尾块且只在最后一个订阅退出后清理原始暂存', async () => {
  const blocks: number[] = [], capture = await captureMicrophone(50, block => blocks.push(block.monoStartUs), vi.fn(), new AbortController().signal)
  expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({ settings: DEFAULT_AUDIO_CAPTURE_SETTINGS, streamSamples: true, shared: true, monitor: false }))
  fake.samples!(block(1_100_000))
  fake.stop.mockImplementation(async () => { fake.samples!(block(1_200_000, 2)); return { ...status, sharedSubscribers: 1 } })
  await capture.stop(); await capture.stop()
  expect(blocks).toEqual([150000, 250000]); expect(fake.stop).toHaveBeenCalledOnce(); expect(fake.remove).not.toHaveBeenCalled()
})
it('原生启动等待中取消，迟到成功的订阅立即释放', async () => {
  const controller = new AbortController()
  fake.start.mockImplementation(async () => { controller.abort(); return status })
  await expect(captureMicrophone(0, vi.fn(), vi.fn(), controller.signal)).rejects.toThrow()
  expect(fake.stop).toHaveBeenCalledWith('native'); expect(fake.remove).toHaveBeenCalledWith('/temp/raw.wav')
})
it('采集已经中断时停止不再次访问失效会话', async () => {
  const interrupt = vi.fn(), capture = await captureMicrophone(0, vi.fn(), interrupt, new AbortController().signal)
  fake.event!({ event: 'interrupted', sessionId: 'native', outputPath: '/temp/raw.wav', writtenBytes: 0, error: { code: 'DEVICE_LOST', message: '麦克风已断开', recoverable: true } })
  await capture.stop(); expect(interrupt).toHaveBeenCalledWith('麦克风已断开'); expect(fake.stop).not.toHaveBeenCalled()
})
