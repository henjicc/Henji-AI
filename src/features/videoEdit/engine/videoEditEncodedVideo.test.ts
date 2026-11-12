import { expect, it, vi } from 'vitest'
import { VideoEditEncoderFailure, type VideoEditEncodedChunk } from './videoEditFrameEncoder'
import type { VideoEditEncodedFrame, VideoEditVideoEncoderStream } from './videoEditRenderTransport'

const muxer = vi.hoisted(() => ({ added: [] as Array<{ timestamp: number; duration: number; type: string; meta?: unknown }>, add: vi.fn() }))
vi.mock('mediabunny', () => ({
  EncodedPacket: class { constructor(readonly data: Uint8Array, readonly type: string, readonly timestamp: number, readonly duration: number) {} },
  EncodedVideoPacketSource: class { constructor(readonly codec: string) {} add = muxer.add },
}))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }) }))
const { VideoEditEncodedVideo, runVideoEditEncodePipeline, videoEditVideoPacketType } = await import('./videoEditEncodedVideo')
const i18n = (await import('@/i18n/config')).default

function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const frameResult = (): VideoEditEncodedFrame => ({ provenance: 'live', singleFrameReads: 0, renderCached: false, renderMs: 1, copyMs: 0, encodeMs: 0, encodeWaitMs: 0, encodeQueue: 1 })

it('流水最多三帧在途；上一帧交给编码器后才发下一帧，完成按帧序回报', async () => {
  const sent: Array<{ submitted: () => void; done: ReturnType<typeof deferred<number>> }> = []
  const finished: number[] = []
  const run = runVideoEditEncodePipeline({ frames: 5, inFlight: 3, signal: new AbortController().signal,
    send: (_index, submitted) => { const done = deferred<number>(); sent.push({ submitted, done }); return done.promise },
    finished: (index, result) => { finished.push(index); expect(result).toBe(index) } })
  await settle()
  expect(sent).toHaveLength(1)
  sent[0].submitted(); await settle()
  expect(sent).toHaveLength(2)
  sent[1].submitted(); await settle()
  sent[2].submitted(); await settle()
  // 三帧都已交给编码器但都没完成：第四帧等最早一帧完成。
  expect(sent).toHaveLength(3)
  sent[1].done.resolve(1); await settle()
  expect(sent).toHaveLength(3); expect(finished).toEqual([])
  sent[0].done.resolve(0); await settle()
  expect(finished).toEqual([0, 1]); expect(sent).toHaveLength(4)
  sent[3].submitted(); await settle()
  expect(sent).toHaveLength(5)
  sent[4].submitted()
  for (const [index, entry] of sent.entries()) entry.done.resolve(index)
  await run
  expect(finished).toEqual([0, 1, 2, 3, 4])
})

it('一帧失败或中止就停止发帧并抛出，在途帧的结果不再处理', async () => {
  const sent: Array<ReturnType<typeof deferred<number>>> = []
  const finished = vi.fn()
  const failing = runVideoEditEncodePipeline({ frames: 10, inFlight: 3, signal: new AbortController().signal,
    send: (index, submitted) => { const done = deferred<number>(); sent.push(done); if (index === 0) submitted(); return done.promise }, finished })
  await settle()
  expect(sent).toHaveLength(2)
  sent[1].reject(new Error('导出在 00:00:00:01 处停止。'))
  await expect(failing).rejects.toThrow('00:00:00:01')
  sent[0].resolve(0); await settle()
  expect(sent).toHaveLength(2); expect(finished).not.toHaveBeenCalled()

  const controller = new AbortController()
  const hung = runVideoEditEncodePipeline({ frames: 10, inFlight: 3, signal: controller.signal, send: () => new Promise(() => {}), finished })
  await settle()
  controller.abort(new DOMException('节目开始播放，预渲染让出。', 'AbortError'))
  await expect(hung).rejects.toThrow('预渲染让出')
})

it('编码结果按送出时的秒数封装，关键帧按间隔节奏，AVC 级别修正在封装前；写入失败在下一帧与收尾时抛出', async () => {
  muxer.added = []; muxer.add.mockReset().mockImplementation(async (packet: { timestamp: number; duration: number; type: string }, meta?: unknown) => { muxer.added.push({ ...packet, meta }) })
  let deliver!: (chunk: VideoEditEncodedChunk) => void
  const samples: unknown[] = []
  const encode: VideoEditVideoEncoderStream['encode'] = async (_frame, sample, _precision, submitted) => { samples.push(sample); submitted(); return frameResult() }
  const stream = { encode: vi.fn(encode), flush: vi.fn(async () => {}), close: vi.fn() }
  const host = { openVideoEncoder: vi.fn(async (_config: VideoEncoderConfig, _output: unknown, onChunk: (chunk: VideoEditEncodedChunk) => void) => { deliver = onChunk; return stream }) }
  const fixed = vi.fn((packet: { data: Uint8Array }) => { packet.data[0] = 42 })
  const video = new VideoEditEncodedVideo({ codec: 'avc', config: { codec: 'avc1.640033', width: 3840, height: 2160, bitrate: 22_500_000 }, keyFrameInterval: 1, onEncodedPacket: fixed }, 'export')
  expect(video.trackMetadata(60)).toEqual({ frameRate: 60, bitrate: 22_500_000, averageBitrate: 22_500_000 })
  await video.open(host)
  const fps = 60000 / 1001
  for (const index of [0, 1, 60]) await video.encode(index, index / fps, 1 / fps, 'exact', () => {})
  expect(samples.map(sample => (sample as { keyFrame: boolean }).keyFrame)).toEqual([true, false, true])
  expect(video.maxInFlight).toBe(3)
  for (const index of [0, 1, 60]) deliver({ data: new Uint8Array([1, 2]).buffer, type: index === 1 ? 'delta' : 'key', timestamp: Math.trunc(index / fps * 1e6), duration: Math.trunc(1e6 / fps), ...(index === 0 ? { decoderConfig: { codec: 'avc1.640033' } } : {}) })
  await video.finish()
  expect(stream.flush).toHaveBeenCalledOnce()
  expect(muxer.added.map(packet => [packet.timestamp, packet.duration, packet.type])).toEqual([[0, 1 / fps, 'key'], [1 / fps, 1 / fps, 'delta'], [60 / fps, 1 / fps, 'key']])
  expect(muxer.added[0].meta).toEqual({ decoderConfig: { codec: 'avc1.640033' } }); expect(fixed).toHaveBeenCalledTimes(3)

  const failingVideo = new VideoEditEncodedVideo({ codec: 'hevc', config: { codec: 'hev1.1.6.L153.B0', width: 1920, height: 1080 }, keyFrameInterval: 2 }, 'renderCache', true)
  await failingVideo.open(host)
  muxer.add.mockRejectedValueOnce(new Error('磁盘已满'))
  await failingVideo.encode(0, 0, 1 / 30, 'exact', () => {})
  deliver({ data: new Uint8Array([1]).buffer, type: 'key', timestamp: 0 })
  await settle()
  await expect(failingVideo.encode(1, 1 / 30, 1 / 30, 'exact', () => {})).rejects.toThrow('磁盘已满')
  await expect(failingVideo.finish()).rejects.toThrow('磁盘已满')
  failingVideo.close(); expect(stream.close).toHaveBeenCalledOnce()
})

/** 长度前缀的编码包：每个 NAL 前 4 字节长度。 */
const lengthPrefixed = (...nals: number[][]): Uint8Array => new Uint8Array(nals.flatMap(nal => [0, 0, 0, nal.length, ...nal]))
// AVC 配置记录第 5 字节、HEVC 配置记录第 22 字节的低两位是长度字段字节数减一。
const avcRecord = new Uint8Array([1, 0x64, 0, 0x33, 0xff, 0xe0])
const hevcRecord = Object.assign(new Uint8Array(23), { 21: 0x0f })

it('首包被编码器错标成 delta 时按码流判断：IDR/IRAP 改回关键帧，真正的非关键帧保持 delta', async () => {
  // AVC：SEI(6) + IDR(5) 为关键帧；非 IDR 切片(1) 为 delta。HEVC：VPS(32)…IDR_W_RADL(19) 为关键帧；TRAIL_R(1) 为 delta。
  expect(videoEditVideoPacketType('avc', { codec: 'avc1.640033', description: avcRecord }, lengthPrefixed([0x06, 1], [0x65, 2]))).toBe('key')
  expect(videoEditVideoPacketType('avc', { codec: 'avc1.640033', description: avcRecord }, lengthPrefixed([0x41, 1]))).toBe('delta')
  expect(videoEditVideoPacketType('hevc', { codec: 'hev1.1.6.L153.B0', description: hevcRecord }, lengthPrefixed([32 << 1, 1], [19 << 1, 1]))).toBe('key')
  expect(videoEditVideoPacketType('hevc', { codec: 'hev1.1.6.L153.B0', description: hevcRecord }, lengthPrefixed([1 << 1, 1]))).toBe('delta')

  muxer.added = []; muxer.add.mockReset().mockImplementation(async (packet: { timestamp: number; duration: number; type: string }) => { muxer.added.push({ ...packet }) })
  let deliver!: (chunk: VideoEditEncodedChunk) => void
  const encode: VideoEditVideoEncoderStream['encode'] = async (_frame, _sample, _precision, submitted) => { submitted(); return frameResult() }
  const host = { openVideoEncoder: vi.fn(async (_config: VideoEncoderConfig, _options: unknown, onChunk: (chunk: VideoEditEncodedChunk) => void) => { deliver = onChunk; return { encode, flush: async () => {}, close() {} } }) }
  const video = new VideoEditEncodedVideo({ codec: 'hevc', config: { codec: 'hev1.1.6.L153.B0', width: 3840, height: 2160 }, keyFrameInterval: 2 }, 'export')
  await video.open(host)
  for (const index of [0, 1]) await video.encode(index, index / 60, 1 / 60, 'exact', () => {})
  const irap = lengthPrefixed([32 << 1, 1], [19 << 1, 1]), trail = lengthPrefixed([1 << 1, 1])
  deliver({ data: irap.slice().buffer, type: 'delta', timestamp: 0, decoderConfig: { codec: 'hev1.1.6.L153.B0', description: hevcRecord } })
  // 之后的包按编码器标注原样封装。
  deliver({ data: trail.slice().buffer, type: 'delta', timestamp: Math.trunc(1e6 / 60) })
  await video.finish()
  expect(muxer.added.map(packet => packet.type)).toEqual(['key', 'delta'])
})

async function failureOf(work: Promise<unknown>): Promise<Error> {
  try { await work } catch (error) { return error as Error }
  throw new Error('应当失败')
}
it('编码器的失败换成可行动的提示（不支持、卡住、出错），原始细节只进日志', async () => {
  const failing = (reason: 'unsupported' | 'stalled' | 'failed') => ({ openVideoEncoder: vi.fn(async () => {
    if (reason === 'unsupported') throw new VideoEditEncoderFailure('unsupported', 'VideoEncoder.isConfigSupported 拒绝：hev1.1.6.L186.B0')
    return { encode: async () => { throw new VideoEditEncoderFailure(reason, '送帧时编码器 30 秒没有进展') }, flush: async () => { throw new VideoEditEncoderFailure(reason, 'flush') }, close() {} }
  }) })
  const spec = { codec: 'hevc' as const, config: { codec: 'hev1.1.6.L186.B0', width: 7680, height: 4320 }, keyFrameInterval: 2 }
  const unsupported = await failureOf(new VideoEditEncodedVideo(spec, 'export').open(failing('unsupported')))
  expect(unsupported.message).toBe(i18n.t('errors:videoEditEncoder.unsupported'))
  expect(unsupported.message).toContain('软件编码'); expect(unsupported.message).not.toContain('hev1')
  for (const reason of ['stalled', 'failed'] as const) {
    const video = new VideoEditEncodedVideo(spec, 'renderCache', true)
    await video.open(failing(reason))
    const error = await failureOf(video.encode(0, 0, 1 / 60, 'exact', () => {}))
    expect(error.message).toBe(i18n.t(`errors:videoEditEncoder.${reason}`)); expect(error.cause).toBeInstanceOf(VideoEditEncoderFailure)
    expect(error.message).not.toBe(`videoEditEncoder.${reason}`)
  }
})
