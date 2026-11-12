import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VIDEO_EDIT_ENCODE_QUEUE_LIMIT, VIDEO_EDIT_ENCODER_STALL_MS, VideoEditEncoderFailure, VideoEditFrameEncoder, type VideoEditEncodedChunk } from './videoEditFrameEncoder'

/** WebCodecs 边界的替身：只复刻队列长度、dequeue 事件、关闭与错误回调。 */
class FakeFrame {
  static live = new Set<FakeFrame>()
  readonly timestamp: number
  readonly duration: number | null
  constructor(readonly source: unknown, init: { timestamp: number; duration?: number }) { this.timestamp = init.timestamp; this.duration = init.duration ?? null; FakeFrame.live.add(this) }
  close(): void { FakeFrame.live.delete(this) }
}
class FakeEncoder extends EventTarget {
  static instances: FakeEncoder[] = []
  static supported = true
  static async isConfigSupported(config: VideoEncoderConfig) { return { supported: FakeEncoder.supported, config } }
  state: CodecState = 'unconfigured'
  encodeQueueSize = 0
  config?: VideoEncoderConfig
  readonly queued: Array<{ timestamp: number; duration: number | null; keyFrame?: boolean; source: unknown }> = []
  constructor(readonly init: VideoEncoderInit) { super(); FakeEncoder.instances.push(this) }
  configure(config: VideoEncoderConfig): void { this.config = config; this.state = 'configured' }
  encode(frame: FakeFrame, options?: VideoEncoderEncodeOptions): void {
    if (this.state !== 'configured') throw new DOMException('编码器已关闭', 'InvalidStateError')
    // 编码器持有自己的一份；调用方随后关闭传入的帧。
    this.queued.push({ timestamp: frame.timestamp, duration: frame.duration, keyFrame: options?.keyFrame, source: frame.source }); this.encodeQueueSize++
  }
  emit(): void {
    const item = this.queued.shift()!; this.encodeQueueSize--
    const chunk = { byteLength: 3, type: item.keyFrame ? 'key' : 'delta', timestamp: item.timestamp, duration: item.duration, copyTo: (target: ArrayBuffer) => new Uint8Array(target).set([1, 2, 3]) } as unknown as EncodedVideoChunk
    const description = new Uint8Array([9, 8, 7, 6]).subarray(1, 3)
    this.init.output(chunk, item.keyFrame ? { decoderConfig: { codec: 'avc1.640033', description, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } } : undefined)
    this.dispatchEvent(new Event('dequeue'))
  }
  async flush(): Promise<void> { while (this.queued.length) this.emit() }
  close(): void { this.state = 'closed'; this.queued.length = 0; this.encodeQueueSize = 0 }
}
const bitmap = (): ImageBitmap => ({ width: 3840, height: 2160, close: vi.fn() }) as unknown as ImageBitmap
const config = { codec: 'avc1.640033', width: 3840, height: 2160 } as VideoEncoderConfig
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  FakeEncoder.instances = []; FakeEncoder.supported = true; FakeFrame.live.clear()
  vi.stubGlobal('VideoEncoder', FakeEncoder); vi.stubGlobal('VideoFrame', FakeFrame)
})
afterEach(() => { vi.unstubAllGlobals() })

it('编码器排满时等它取走一帧再返回；时间按微秒截断，关键帧原样，编码结果带可跨线程的解码配置', async () => {
  const chunks: VideoEditEncodedChunk[] = []
  const encoder = await VideoEditFrameEncoder.open(config, undefined, chunk => chunks.push(chunk))
  const native = FakeEncoder.instances[0]
  expect(native.config).toBe(config)
  const pictures = [bitmap(), bitmap(), bitmap()]
  await encoder.encode(pictures[0], { timestamp: 0, duration: 1 / 60, keyFrame: true })
  let second = false
  const waiting = encoder.encode(pictures[1], { timestamp: 1 / 60, duration: 1 / 60, keyFrame: false }).then(timing => { second = true; return timing })
  await settle()
  // 第二帧已经进了编码器，但队列到了上限：Worker 不去合成下一帧。
  expect(native.encodeQueueSize).toBe(VIDEO_EDIT_ENCODE_QUEUE_LIMIT); expect(second).toBe(false)
  native.emit()
  const timing = await waiting
  expect(timing.encodeQueue).toBe(2); expect(timing.encodeWaitMs).toBeGreaterThanOrEqual(0)
  expect(native.queued.map(item => [item.timestamp, item.duration, item.keyFrame])).toEqual([[16666, 16666, false]])
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({ type: 'key', timestamp: 0, duration: 16666, decoderConfig: { codec: 'avc1.640033', colorSpace: { primaries: 'bt709', fullRange: false } } })
  expect(new Uint8Array(chunks[0].data)).toEqual(new Uint8Array([1, 2, 3]))
  expect(new Uint8Array(chunks[0].decoderConfig!.description as ArrayBuffer)).toEqual(new Uint8Array([8, 7]))
  // 编码帧与合成位图在交给编码器后都已关闭。
  expect(FakeFrame.live.size).toBe(0); for (const picture of pictures.slice(0, 2)) expect(picture.close).toHaveBeenCalledOnce()
  const third = encoder.encode(pictures[2], { timestamp: 2 / 60, duration: 1 / 60, keyFrame: false })
  await settle()
  await encoder.flush(); await third
  expect(chunks.map(chunk => chunk.timestamp)).toEqual([0, 16666, 33333])
  expect(native.state).toBe('closed')
})

it('取消时等背压的一帧立即返回，之后的帧不进编码器；编码器报错后下一帧失败并关闭位图', async () => {
  const encoder = await VideoEditFrameEncoder.open(config, undefined, () => {})
  const native = FakeEncoder.instances[0]
  await encoder.encode(bitmap(), { timestamp: 0, duration: 1 / 60, keyFrame: true })
  const blocked = encoder.encode(bitmap(), { timestamp: 1 / 60, duration: 1 / 60, keyFrame: false })
  await settle()
  encoder.close()
  await expect(blocked).rejects.toThrow('视频编码已停止')
  const late = bitmap()
  await expect(encoder.encode(late, { timestamp: 2 / 60, duration: 1 / 60, keyFrame: false })).rejects.toThrow('视频编码已停止')
  expect(late.close).toHaveBeenCalledOnce(); expect(native.state).toBe('closed'); expect(FakeFrame.live.size).toBe(0)

  const failing = await VideoEditFrameEncoder.open(config, undefined, () => {})
  FakeEncoder.instances[1].init.error(new DOMException('硬件编码器失败', 'EncodingError'))
  const picture = bitmap()
  await expect(failing.encode(picture, { timestamp: 0, duration: 1 / 60, keyFrame: true })).rejects.toMatchObject({ reason: 'failed', message: '硬件编码器失败' })
  expect(picture.close).toHaveBeenCalledOnce(); expect(FakeFrame.live.size).toBe(0)
  await expect(failing.flush()).rejects.toBeInstanceOf(VideoEditEncoderFailure)
})

it('闲置被浏览器回收的编码器换新的继续编，并从关键帧开始；配置不受支持时打开即说明原因', async () => {
  const encoder = await VideoEditFrameEncoder.open(config, undefined, () => {})
  FakeEncoder.instances[0].init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'))
  await encoder.encode(bitmap(), { timestamp: 5, duration: 1 / 60, keyFrame: false })
  expect(FakeEncoder.instances).toHaveLength(2)
  expect(FakeEncoder.instances[1].config).toBe(config)
  expect(FakeEncoder.instances[1].queued[0].keyFrame).toBe(true)
  FakeEncoder.supported = false
  await expect(VideoEditFrameEncoder.open(config, undefined, () => {})).rejects.toMatchObject({ reason: 'unsupported', message: expect.stringContaining('avc1.640033') })
})

it('成片画幅不同时按导出几何画进黑底画布再编码，两份位图都释放', async () => {
  const draw = vi.fn(), fill = vi.fn()
  const scaled = bitmap()
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return { fillRect: fill, drawImage: draw, fillStyle: '' } } transferToImageBitmap() { return scaled } })
  const geometry = { width: 2560, height: 1440, source: { x: 0, y: 0, width: 3840, height: 2160 }, destination: { x: 0, y: 0, width: 2560, height: 1440 } }
  const encoder = await VideoEditFrameEncoder.open(config, geometry, () => {})
  const picture = bitmap()
  await encoder.encode(picture, { timestamp: 0, duration: 1 / 60, keyFrame: true })
  expect(fill).toHaveBeenCalledWith(0, 0, 2560, 1440)
  expect(draw).toHaveBeenCalledWith(picture, 0, 0, 3840, 2160, 0, 0, 2560, 1440)
  expect(FakeEncoder.instances[0].queued[0].source).toBe(scaled)
  expect(picture.close).toHaveBeenCalledOnce(); expect(scaled.close).toHaveBeenCalledOnce()
})

it('编码器手里有帧却长时间既不取走也不交结果：送帧与收尾都按“编码器卡住”失败并关闭编码器，不等渲染看门狗', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  try {
    const encoder = await VideoEditFrameEncoder.open(config, undefined, () => {})
    const native = FakeEncoder.instances[0]
    await encoder.encode(bitmap(), { timestamp: 0, duration: 1 / 60, keyFrame: true })
    let failure: unknown
    const blocked = encoder.encode(bitmap(), { timestamp: 1 / 60, duration: 1 / 60, keyFrame: false }).catch(error => { failure = error })
    await vi.advanceTimersByTimeAsync(VIDEO_EDIT_ENCODER_STALL_MS - 1000)
    expect(failure).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2000); await blocked
    expect(failure).toMatchObject({ reason: 'stalled' }); expect(native.state).toBe('closed'); expect(FakeFrame.live.size).toBe(0)

    const finishing = await VideoEditFrameEncoder.open(config, undefined, () => {})
    FakeEncoder.instances[1].flush = () => new Promise(() => {})
    const flushed = finishing.flush().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(VIDEO_EDIT_ENCODER_STALL_MS + 1)
    expect(await flushed).toMatchObject({ reason: 'stalled' }); expect(FakeEncoder.instances[1].state).toBe('closed')
  } finally { vi.useRealTimers() }
})
