import { it, expect, vi } from 'vitest'
import { ChromiumCaptureBackend, type CaptureSink, type ChromiumDependencies } from './chromium'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
vi.mock('@/features/videoEdit/engine/videoEditExportEncoder', () => ({ selectVideoEditExportEncoder: vi.fn(), videoEditExportVideoOptions: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 })
it('closes late streams after cancellation and never leaves device tracks live', async () => {
  let resolve!: (value: MediaStream) => void
  const stop = vi.fn(), stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const backend = new ChromiumCaptureBackend(options, {} as CaptureSink, { stream: () => new Promise(r => { resolve = r }), reader: () => { throw new Error('不应读取帧') }, mux: async () => { throw new Error('不应启动编码') } })
  const prepare = backend.prepare(); const assertion = expect(prepare).rejects.toThrow('取消')
  const cancel = backend.cancel(); resolve(stream)
  await assertion; await cancel
  expect(stop).toHaveBeenCalledOnce()
})
it('bounds frame flow, preserves media timestamps, seals on pause and opens a new span on resume', async () => {
  const track = { enabled: false, stop: vi.fn(), addEventListener: vi.fn() }
  const frames = [1_000_000, 1_016_667, 1_033_334].map(timestamp => ({ timestamp, close: vi.fn() } as unknown as VideoFrame))
  let end!: (result: ReadableStreamReadResult<VideoFrame>) => void
  const add = vi.fn(async (_frame: VideoFrame, _time: number) => undefined), finish = vi.fn(async () => undefined)
  const sink: CaptureSink = { clock: async () => 1_000_000, anchor: vi.fn(), open: vi.fn(async () => ({ index: 0, file: 'screen-000000.mp4', monoUs: 0, durationUs: 0, finalized: false })), write: vi.fn(), seal: vi.fn(), failed: vi.fn() }
  const deps: ChromiumDependencies = {
    stream: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream),
    reader: () => ({ read: async () => frames.length ? { done: false, value: frames.shift()! } : new Promise(resolve => { end = resolve }), cancel: async () => { end?.({ done: true, value: undefined }) }, releaseLock: vi.fn() }),
    mux: async () => ({ add, finish, cancel: vi.fn() }),
  }
  const backend = new ChromiumCaptureBackend(options, sink, deps), signal = new AbortController().signal
  await backend.prepare(); expect(track.enabled).toBe(false)
  await backend.start(signal)
  await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(3))
  await backend.pause(signal)
  expect(track.enabled).toBe(false); expect(finish).toHaveBeenCalledOnce()
  expect(add.mock.calls.map(call => call[1])).toEqual([0, .016667, .033334])
  expect(sink.seal).toHaveBeenCalledWith(0, 50001)
  await backend.resume(signal); await backend.stop(signal)
  expect(sink.open).toHaveBeenCalledTimes(2); expect(track.stop).toHaveBeenCalledOnce(); expect(sink.failed).not.toHaveBeenCalled()
})
