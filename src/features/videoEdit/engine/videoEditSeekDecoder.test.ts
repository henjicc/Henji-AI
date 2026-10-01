import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditSeekDecoder } from './videoEditSeekDecoder'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import type { VideoSample } from 'mediabunny'

const fixture = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined, fail: false, ranges: vi.fn(), inputClosed: vi.fn(), decodedClosed: vi.fn(), copied: vi.fn() }))
vi.mock('mediabunny', () => {
  class Sample {
    codedWidth = 10; codedHeight = 10; displayWidth = 10; displayHeight = 10
    format = 'RGBA'; rotation = 0; flip = false
    readonly timestamp: number; readonly duration: number
    constructor(_source: unknown, init: { timestamp: number; duration: number }) { this.timestamp = init.timestamp; this.duration = init.duration }
    allocationSize(): number { return 400 }
    clone(): Sample { return new Sample(null, { timestamp: this.timestamp, duration: this.duration }) }
    toVideoFrame(): { close(): void } { return { close: () => {} } }
    close(): void { fixture.decodedClosed() }
  }
  return {
    ALL_FORMATS: [], UrlSource: class {}, VideoSample: Sample,
    Input: class {
      async getPrimaryVideoTrack(): Promise<{ getDecoderConfig(): Promise<{ codec: string }> }> { return { getDecoderConfig: async () => ({ codec: 'avc1' }) } }
      dispose(): void { fixture.inputClosed() }
    },
    EncodedPacketSink: class {
      async getKeyPacket(time: number): Promise<{ timestamp: number }> { return { timestamp: Math.floor(time / 2) * 2 } }
      async getNextKeyPacket(key: { timestamp: number }): Promise<{ timestamp: number }> { return { timestamp: key.timestamp + 2 } }
    },
    VideoSampleSink: class {
      async *samples(start: number): AsyncGenerator<Sample, void, unknown> {
        fixture.ranges(start)
        yield new Sample(null, { timestamp: start, duration: .037 })
        if (fixture.gate) await fixture.gate
        if (fixture.fail) throw new Error('decode failed')
        yield new Sample(null, { timestamp: start + .037, duration: .063 })
        yield new Sample(null, { timestamp: start + .1, duration: 1.9 })
      }
    },
  }
})
const snapshot = async (sample: VideoSample): Promise<VideoEditGpuFrame> => { fixture.copied(); return new VideoEditGpuFrame(sample, { createView: () => ({}), destroy: () => {} }, { createView: () => ({}), destroy: () => {} }, 400) }
const tick = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
afterEach(() => { vi.useRealTimers() })
beforeEach(() => {
  fixture.gate = undefined; fixture.fail = false
  fixture.ranges.mockReset(); fixture.inputClosed.mockReset(); fixture.decodedClosed.mockReset(); fixture.copied.mockReset()
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext(): { drawImage: () => void } { return { drawImage: fixture.copied } }
  })
})
it('首帧不等完整 GOP，原素材的正反定位复用同一解码范围并保留 VFR 时间', async () => {
  let release!: () => void; fixture.gate = new Promise(resolve => { release = resolve })
  const cache = new VideoEditFrameCache(2400); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  const first = await decoder.sample(0, 0); expect(first.sample?.timestamp).toBe(0); first.sample?.close()
  expect(fixture.ranges).toHaveBeenCalledOnce()
  release(); await tick()
  for (const time of [.12, .037, .036]) {
    const result = await decoder.sample(time, 0)
    expect(result.hit).toBe(true); expect(result.sample?.timestamp).toBe(time >= .1 ? .1 : time >= .037 ? .037 : 0); result.sample?.close()
  }
  expect(fixture.ranges).toHaveBeenCalledOnce(); expect(fixture.copied).toHaveBeenCalledTimes(3)
  await decoder.dispose(); expect(cache.bytes).toBe(0); expect(fixture.inputClosed).toHaveBeenCalledOnce()
})
it('首次定位与缓存命中呈现同一已完成GPU纹理，不混用原解码颜色路径', async () => {
  const cache = new VideoEditFrameCache(2400); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  const first = await decoder.sample(0, 0)
  expect(first.sample).toBeInstanceOf(VideoEditGpuFrame); expect(first.hit).toBe(false)
  const next = await decoder.sample(0, 0)
  expect(next.sample).toBeInstanceOf(VideoEditGpuFrame); expect(next.hit).toBe(true)
  expect((first.sample as VideoEditGpuFrame).texture).toBe((next.sample as VideoEditGpuFrame).texture)
  first.sample?.close(); next.sample?.close(); await decoder.dispose()
  expect(cache.bytes).toBe(0)
})
it('单帧超出缓存预算仍交付独立借用，调用方关闭后只释放一次', async () => {
  let release!: () => void; fixture.gate = new Promise(resolve => { release = resolve })
  const destroyed = vi.fn(); const cache = new VideoEditFrameCache(1)
  const decoder = new VideoEditSeekDecoder('media:original', cache, async sample => new VideoEditGpuFrame(sample, { createView: () => ({}), destroy: destroyed }, undefined, 400))
  const first = await decoder.sample(0, 0)
  expect(cache.bytes).toBe(0); expect(destroyed).not.toHaveBeenCalled()
  expect((first.sample as VideoEditGpuFrame).texture).toBeDefined()
  first.sample?.close(); first.sample?.close(); expect(destroyed).toHaveBeenCalledOnce()
  const closed = decoder.dispose(); release(); await closed
  expect(destroyed).toHaveBeenCalledOnce()
})
it('同一时间的不同原文件隔离，销毁一个输入不能删除其他素材的帧', async () => {
  const cache = new VideoEditFrameCache(4800); const a = new VideoEditSeekDecoder('media:a', cache, snapshot); const b = new VideoEditSeekDecoder('media:b', cache, snapshot)
  const initial = await Promise.all([a.sample(0, 0), b.sample(0, 0)]); initial.forEach(result => result.sample?.close()); await tick()
  await a.dispose(); expect(cache.bytes).toBeGreaterThan(0)
  const result = await b.sample(.037, 0); expect(result.hit).toBe(true); result.sample?.close()
  await b.dispose(); expect(cache.bytes).toBe(0)
})
it('关闭时拒绝未完成定位，迟到解码不进入已关闭的工作集', async () => {
  let release!: () => void; fixture.gate = new Promise(resolve => { release = resolve })
  const cache = new VideoEditFrameCache(2400); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  const first = await decoder.sample(0, 0); first.sample?.close()
  const pending = decoder.sample(.1, 0); const rejected = expect(pending).rejects.toThrow('关闭'); await tick()
  const closed = decoder.dispose(); release(); await rejected; await closed; await tick()
  expect(cache.bytes).toBe(0); await expect(decoder.sample(0, 0)).rejects.toThrow('关闭')
})
it('后台解码失败传给后续定位，不能永远等待或重复启动失败范围', async () => {
  fixture.fail = true
  const cache = new VideoEditFrameCache(2400); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  await expect(decoder.sample(.1, 0)).rejects.toThrow('decode failed')
  await expect(decoder.sample(.1, 0)).rejects.toThrow('decode failed')
  expect(fixture.ranges).toHaveBeenCalledOnce(); await decoder.dispose()
})
it('反向预取检查上一段末帧，不能因已淘汰的首帧重复解码整个 GOP', async () => {
  const cache = new VideoEditFrameCache(2000); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  const first = await decoder.sample(0, 0); first.sample?.close(); await tick()
  const next = await decoder.sample(2, 0); next.sample?.close(); await tick()
  expect(cache.get('media:original', 0)).toBeUndefined()
  expect(cache.get('media:original', 2 - 1e-6)).toBeDefined()
  const reversed = await decoder.sample(2.1, -1); reversed.sample?.close(); await tick()
  expect(fixture.ranges.mock.calls.map(call => call[0])).toEqual([0, 2])
  await decoder.dispose()
})
it('取消预取后销毁仍等待迟到 GPU 复制，不能遗留纹理或再次写入工作集', async () => {
  vi.useFakeTimers()
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  const lateReleased = vi.fn()
  const cache = new VideoEditFrameCache(2400)
  const decoder = new VideoEditSeekDecoder('media:original', cache, async sample => {
    if (sample.timestamp === 2) {
      await gate
      return new VideoEditGpuFrame(sample, { createView: () => ({}), destroy: () => {} }, undefined, 400, lateReleased)
    }
    return snapshot(sample)
  })
  const first = await decoder.sample(0, 0); first.sample?.close(); await tick()
  const moving = await decoder.sample(1.1, 1); moving.sample?.close(); await tick()
  await vi.advanceTimersByTimeAsync(50)
  const stopped = await decoder.sample(1.1, 0); stopped.sample?.close()
  let finished = false; const disposing = decoder.dispose().then(() => { finished = true })
  await tick(); expect(finished).toBe(false)
  release(); await disposing
  expect(lateReleased).toHaveBeenCalledOnce(); expect(cache.bytes).toBe(0)
})
it('同一帧复制期间收到工程刷新请求，仍返回该帧而非等待整段后给出空画面', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  const cache = new VideoEditFrameCache(2400)
  const decoder = new VideoEditSeekDecoder('media:original', cache, async sample => { if (sample.timestamp === 0) await gate; return snapshot(sample) })
  const first = decoder.sample(0, 0); await tick()
  const refreshed = decoder.sample(0, 0); await tick()
  release(); const initial = await first; initial.sample?.close(); const result = await refreshed
  expect(result.sample?.timestamp).toBe(0); result.sample?.close()
  await decoder.dispose(); expect(cache.bytes).toBe(0)
})

it('停止拖动取消尚未开始的邻段预取，不再创建硬件解码器', async () => {
  vi.useFakeTimers()
  const cache = new VideoEditFrameCache(2400); const decoder = new VideoEditSeekDecoder('media:original', cache, snapshot)
  const first = await decoder.sample(0, 0); first.sample?.close(); await tick()
  const moving = await decoder.sample(1.1, 1); moving.sample?.close()
  const stopped = await decoder.sample(1.1, 0); stopped.sample?.close()
  await vi.advanceTimersByTimeAsync(100)
  expect(fixture.ranges).toHaveBeenCalledOnce(); await decoder.dispose()
})
