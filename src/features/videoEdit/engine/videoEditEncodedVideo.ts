import { EncodedPacket, EncodedVideoPacketSource, type VideoTrackMetadata } from 'mediabunny'
import i18n from '@/i18n/config'
import { createLogger } from '@/core/logging'
import type { VideoEditRenderPrecision } from './videoEditRenderer'
import type { VideoEditEncodedFrame, VideoEditVideoEncoderStream } from './videoEditRenderTransport'
import { VideoEditEncoderFailure, type VideoEditEncodedChunk, type VideoEditEncodeGeometry, type VideoEditEncodePurpose } from './videoEditFrameEncoder'
import type { VideoEditExportVideoStream } from './videoEditExportEncoderConfig'

const logger = createLogger('features.videoEdit.exportEncoder')
/** 等着写进文件的编码结果超过这么多份时，先等封装写完再发下一帧（文件写入的背压）。 */
const MUX_BACKLOG_LIMIT = 8

export interface VideoEditEncoderHost {
  openVideoEncoder(config: VideoEncoderConfig, options: { purpose: VideoEditEncodePurpose; output?: VideoEditEncodeGeometry }, onChunk: (chunk: VideoEditEncodedChunk) => void): Promise<VideoEditVideoEncoderStream>
}

/* Packet type detection adapted from Mediabunny 1.61.0 src/codec-data.ts (determineVideoPacketType).
 * Copyright (c) 2026-present, Vanilagy and contributors. MPL-2.0: https://mozilla.org/MPL/2.0/
 * Only the length-prefixed layout is needed: the encoder is configured with avc/hevc format, whose output always
 * carries a configuration record. The H.264 recovery-point SEI branch is omitted: mediabunny skips it on Chromium.
 */
function lengthPrefixedNalTypes(data: Uint8Array, lengthSize: number, typeOf: (header: number) => number): number[] {
  const types: number[] = []
  for (let offset = 0; offset + lengthSize <= data.length;) {
    let length = 0
    for (let index = 0; index < lengthSize; index++) length = length * 256 + data[offset++]
    if (offset < data.length) types.push(typeOf(data[offset]))
    offset += length
  }
  return types
}
/** 按码流里的 NAL 类型判断一个 AVC/HEVC 编码包是否关键帧；判断不出时为 delta。 */
export function videoEditVideoPacketType(codec: 'avc' | 'hevc', decoderConfig: VideoDecoderConfig, data: Uint8Array): 'key' | 'delta' {
  const description = decoderConfig.description
  if (!description) return 'delta'
  const record = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
  if (codec === 'avc') {
    for (const type of lengthPrefixedNalTypes(data, (record[4] & 3) + 1, header => header & 0x1f)) {
      // 1–4 为非 IDR 切片，5 为 IDR。
      if (type >= 1 && type <= 4) return 'delta'
      if (type === 5) return 'key'
    }
    return 'delta'
  }
  for (const type of lengthPrefixedNalTypes(data, (record[21] & 3) + 1, header => (header >> 1) & 0x3f)) {
    // 0–15 为非 IRAP 切片，16（BLA_W_LP）到 23 为 IRAP。
    if (type < 16) return 'delta'
    if (type <= 23) return 'key'
  }
  return 'delta'
}

/**
 * 一条在剪辑渲染 Worker 里编码的视频轨：界面线程只收压缩结果、还原精确时间并封装。
 * 时间、关键帧节奏、首包类型校正、AVC 级别修正与轨道标称码率都与 mediabunny 自己编码时一致。
 */
export class VideoEditEncodedVideo {
  readonly source: EncodedVideoPacketSource
  /** 送出、还没收到编码结果的帧数最大值（合成、GPU 完成与编码各段一共在途多少帧）。 */
  maxInFlight = 0
  private stream?: VideoEditVideoEncoderStream
  /** 编码器只认微秒；按微秒时间还原送出时的秒数，与 mediabunny 的精确时间表相同。 */
  private readonly timings = new Map<number, { timestamp: number; duration: number }>()
  private lastKeyFrameSlot = -1
  private sent = 0
  private received = 0
  private muxing: Promise<void> = Promise.resolve()
  private backlog = 0
  private muxFailure?: unknown
  private failureLogged = false
  constructor(private readonly spec: VideoEditExportVideoStream, private readonly purpose: VideoEditEncodePurpose, private readonly allKeyFrames = false) {
    this.source = new EncodedVideoPacketSource(spec.codec)
  }
  trackMetadata(frameRate: number): VideoTrackMetadata {
    const bitrate = this.spec.config.bitrate
    return { frameRate, ...(bitrate ? { bitrate, averageBitrate: bitrate } : {}) }
  }
  /** 编码器的失败换成用户能据此行动的提示，原始细节只进日志（同一条轨只记一次）。 */
  private userError(error: unknown): unknown {
    if (!(error instanceof VideoEditEncoderFailure)) return error
    if (!this.failureLogged) {
      this.failureLogged = true
      logger.warn('剪辑视频编码失败', { event: this.purpose === 'export' ? 'video_edit.export.encoder_failed' : 'video_edit.render_cache.encoder_failed', error, context: { reason: error.reason, detail: error.message, configuration: { ...this.spec.config } } })
    }
    return new Error(i18n.t(`errors:videoEditEncoder.${error.reason}`), { cause: error })
  }
  async open(host: VideoEditEncoderHost, output?: VideoEditEncodeGeometry): Promise<void> {
    // 预渲染每个窗口开一条，只记 debug。
    const context = { configuration: { ...this.spec.config }, keyFrameInterval: this.allKeyFrames ? 0 : this.spec.keyFrameInterval, worker: true }
    if (this.purpose === 'export') logger.info('导出原生视频编码配置', { event: 'video_edit.export.encoder_config', context })
    else logger.debug('预渲染原生视频编码配置', { event: 'video_edit.render_cache.encoder_config', context })
    try { this.stream = await host.openVideoEncoder(this.spec.config, { purpose: this.purpose, ...(output ? { output } : {}) }, chunk => this.receive(chunk)) }
    catch (error) { throw this.userError(error) }
  }
  /** 渲染并编码序列帧 `frame`，放在成片的 `timestamp` 秒处；返回值见 `VideoEditVideoEncoderStream.encode`。 */
  async encode(frame: number, timestamp: number, duration: number, precision: VideoEditRenderPrecision, submitted: () => void): Promise<VideoEditEncodedFrame> {
    if (!this.stream) throw new Error('视频编码尚未打开。')
    this.assertMuxing()
    if (this.backlog > MUX_BACKLOG_LIMIT) { await this.muxing; this.assertMuxing() }
    const interval = this.spec.keyFrameInterval
    const slot = Math.floor(timestamp / interval)
    const keyFrame = this.allKeyFrames || interval === 0 || slot !== this.lastKeyFrameSlot
    this.lastKeyFrameSlot = slot
    this.timings.set(Math.trunc(timestamp * 1e6), { timestamp, duration })
    this.sent++
    this.maxInFlight = Math.max(this.maxInFlight, this.sent - this.received)
    try { return await this.stream.encode(frame, { timestamp, duration, keyFrame }, precision, submitted) }
    catch (error) { throw this.userError(error) }
  }
  private receive(chunk: VideoEditEncodedChunk): void {
    this.received++
    const timing = this.timings.get(chunk.timestamp)
    this.timings.delete(chunk.timestamp)
    const data = new Uint8Array(chunk.data)
    // 有的硬件编码器把第一个包错标成 delta（Windows + AMD 编 HEVC 时常见，mediabunny issue #365），封装层要求首包是关键帧：
    // 与 mediabunny 一样，首包标成 delta 时按码流本身判断。
    const type = this.received === 1 && chunk.type === 'delta' && chunk.decoderConfig ? videoEditVideoPacketType(this.spec.codec, chunk.decoderConfig, data) : chunk.type
    const packet = new EncodedPacket(data, type, timing?.timestamp ?? chunk.timestamp / 1e6, timing?.duration ?? (chunk.duration ?? 0) / 1e6)
    const meta = chunk.decoderConfig ? { decoderConfig: chunk.decoderConfig } : undefined
    this.backlog++
    this.muxing = this.muxing.then(async () => {
      if (this.muxFailure !== undefined) return
      this.spec.onEncodedPacket?.(packet, meta)
      await this.source.add(packet, meta)
    }).catch(error => { this.muxFailure ??= error }).finally(() => { this.backlog-- })
  }
  private assertMuxing(): void { if (this.muxFailure !== undefined) throw this.muxFailure }
  /** 等编码器交出全部结果并写进封装。 */
  async finish(): Promise<void> {
    if (!this.stream) throw new Error('视频编码尚未打开。')
    try { await this.stream.flush() } catch (error) { throw this.userError(error) }
    await this.muxing
    this.assertMuxing()
  }
  /** 取消或失败时立即停止 Worker 里的编码；已结束时什么也不做。 */
  close(): void { this.stream?.close() }
}

export interface VideoEditEncodePipeline<T> {
  frames: number
  /** 同时在途（已发出、还没完成）的帧数上限。 */
  inFlight: number
  signal: AbortSignal
  /** 发出第 `index` 帧之前（例如先补上这一帧之前的声音）。 */
  before?(index: number): Promise<void> | void
  /** 发出第 `index` 帧：画面交给编码器后调 `submitted`，这一帧完成后返回。 */
  send(index: number, submitted: () => void): Promise<T>
  /** 第 `index` 帧完成，按帧序依次调用。 */
  finished(index: number, result: T): Promise<void> | void
}
/**
 * 多帧在途的编码流水：上一帧交给编码器后就发下一帧（Worker 里最多一帧排队，看门狗只算各自的合成），
 * 在途帧数到上限时等最早一帧完成；编码器自身的队列另由 Worker 背压。任一帧失败或中止即停止发帧并抛出，
 * 已发出的帧由调用方关闭编码流一并停下。
 */
export async function runVideoEditEncodePipeline<T>(pipeline: VideoEditEncodePipeline<T>): Promise<void> {
  const { signal } = pipeline
  let abort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason) })
  aborted.catch(() => undefined)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const wait = <V>(work: Promise<V>): Promise<V> => Promise.race([work, aborted])
  const pending: Array<{ index: number; done: Promise<T> }> = []
  const settle = async (): Promise<void> => { const first = pending.shift()!; await pipeline.finished(first.index, await wait(first.done)) }
  let handedOver: Promise<void> = Promise.resolve()
  try {
    for (let index = 0; index < pipeline.frames; index++) {
      signal.throwIfAborted()
      while (pending.length >= pipeline.inFlight) await settle()
      await wait(handedOver)
      await pipeline.before?.(index)
      signal.throwIfAborted()
      let submitted!: () => void
      const accepted = new Promise<void>(resolve => { submitted = resolve })
      const done = pipeline.send(index, submitted)
      done.catch(() => undefined)
      handedOver = Promise.race([accepted, done.then(() => undefined)])
      handedOver.catch(() => undefined)
      pending.push({ index, done })
    }
    while (pending.length) await settle()
  } finally { signal.removeEventListener('abort', abort) }
}
