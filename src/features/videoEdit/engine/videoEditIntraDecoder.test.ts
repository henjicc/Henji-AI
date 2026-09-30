import { afterEach, expect, it, vi } from 'vitest'
import type { InputVideoTrack } from 'mediabunny'
const state = vi.hoisted(() => ({ timestamp: 0, type: 'key', frames: [] as Array<{ close: ReturnType<typeof vi.fn> }>, configure: vi.fn(), close: vi.fn() }))
vi.mock('mediabunny', () => ({
  EncodedPacketSink: class { async getPacket(time: number) { state.timestamp = Math.round(time * 1e6); return { type: state.type, duration: 1 / 60, timestamp: time, microsecondTimestamp: state.timestamp, toEncodedVideoChunk: () => ({ type: 'key', timestamp: Math.round(time * 1e6), byteLength: 1, copyTo: (target: Uint8Array) => target.set([0x65]) }) } } },
  // VideoSample takes ownership of the supplied VideoFrame, rather than cloning it.
  VideoSample: class { constructor(readonly frame: { close(): void }) {} close() { this.frame.close() } },
}))
import { VideoEditIntraDecoder } from './videoEditIntraDecoder'
afterEach(() => { vi.unstubAllGlobals(); state.type = 'key'; state.frames = []; vi.clearAllMocks() })
it('往返定位复用配置和解码器；帧交给合成器前不关闭，使用结束才释放', async () => {
  vi.stubGlobal('VideoDecoder', class {
    state = 'configured'
    constructor(readonly callbacks: VideoDecoderInit) {}
    configure = state.configure
    timestamps: number[] = []
    decode(chunk: { timestamp: number }) { this.timestamps.push(chunk.timestamp) }
    async flush() { for (const timestamp of this.timestamps.splice(0)) { const frame = { timestamp, close: vi.fn() }; state.frames.push(frame); this.callbacks.output(frame as unknown as VideoFrame) } }
    close = state.close
  })
  const decoder = new VideoEditIntraDecoder({} as InputVideoTrack, { codec: 'avc1.640033' })
  const first = await decoder.sample(2); const second = await decoder.sample(1)
  expect(state.configure).toHaveBeenCalledOnce()
  expect((first as unknown as { frame: { close: ReturnType<typeof vi.fn> } }).frame.close).not.toHaveBeenCalled()
  expect((second as unknown as { frame: { close: ReturnType<typeof vi.fn> } }).frame.close).not.toHaveBeenCalled()
  first?.close(); second?.close(); decoder.close()
  expect(state.frames.every(frame => frame.close.mock.calls.length === 1)).toBe(true)
  expect(state.close).toHaveBeenCalledOnce()
})
it('拒绝把依赖前帧的压缩包送入独立帧定位路径', async () => {
  vi.stubGlobal('VideoDecoder', class { configure() {} decode() { throw new Error('不应解码') } close() {} })
  const decoder = new VideoEditIntraDecoder({} as InputVideoTrack, { codec: 'avc1.640033' })
  state.type = 'delta'
  await expect(decoder.sample(0)).rejects.toThrow('独立可定位')
  decoder.close()
})

it('AVC 独立帧补齐访问单元边界，保留原压缩包且只解码一次', async () => {
  const decode = vi.fn()
  vi.stubGlobal('EncodedVideoChunk', class { constructor(readonly init: EncodedVideoChunkInit) {} })
  vi.stubGlobal('VideoDecoder', class {
    state = 'configured'
    constructor(readonly callbacks: VideoDecoderInit) {}
    configure() {}
    decode(chunk: { init: EncodedVideoChunkInit }) {
      decode(chunk.init); const frame = { timestamp: chunk.init.timestamp, close: vi.fn() }
      state.frames.push(frame); this.callbacks.output(frame as unknown as VideoFrame)
    }
    flush() { throw new Error('即时输出不应排空管线') }
    close() {}
  })
  const decoder = new VideoEditIntraDecoder({} as InputVideoTrack, { codec: 'avc1.640033', description: new Uint8Array([1, 100, 0, 51, 255]) })
  const sample = await decoder.sample(1)
  expect(decode).toHaveBeenCalledOnce()
  expect(decode.mock.calls[0][0].data).toEqual(new Uint8Array([0x65, 0, 0, 0, 2, 9, 240]))
  sample?.close(); decoder.close(); expect(state.frames[0].close).toHaveBeenCalledOnce()
})
