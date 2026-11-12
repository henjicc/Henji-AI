import { BLACK_HEX } from '@/core/theme/colorTokens'

/**
 * 剪辑渲染 Worker 里的视频编码：合成结果（合成设备画布拷出的 GPU 位图）直接构造 VideoFrame 送进 VideoEncoder，
 * 不回界面线程、不经 2D 画布。编码结果只把压缩数据交回界面线程封装。
 */

/** 编码器排到这么多帧时，Worker 等编码器取走一帧再去合成下一帧（背压）；在途的 VideoFrame 因此有上限。 */
export const VIDEO_EDIT_ENCODE_QUEUE_LIMIT = 2
/**
 * 编码器手里有帧、却这么久既没取走一帧也没交出结果，就判定编码器卡住并停止。短于渲染会话 60 秒的请求看门狗，
 * 卡在编码器时报编码原因，而不是被看门狗当成合成（代码效果）超时。
 */
export const VIDEO_EDIT_ENCODER_STALL_MS = 30_000

/** 编码失败的原因：设备不支持所选设置、编码器卡住、编码器报错。`message` 是诊断细节，界面线程据 `reason` 给用户提示。 */
export type VideoEditEncoderFailureReason = 'unsupported' | 'stalled' | 'failed'
export class VideoEditEncoderFailure extends Error {
  constructor(readonly reason: VideoEditEncoderFailureReason, detail: string, options?: ErrorOptions) {
    super(detail, options)
    this.name = 'VideoEditEncoderFailure'
  }
}

/** 编码流的用途：成片导出或预渲染（日志按用途分事件与级别）。 */
export type VideoEditEncodePurpose = 'export' | 'renderCache'
export interface VideoEditEncodeRect { x: number; y: number; width: number; height: number }
/** 成片画幅与合成画面不同（裁切、留边、缩放）时，合成画面在成片里的位置；源矩形按合成画面的像素计。 */
export interface VideoEditEncodeGeometry { width: number; height: number; source: VideoEditEncodeRect; destination: VideoEditEncodeRect }
/** 一帧在成片里的时间与时长（秒），以及是否编成关键帧。 */
export interface VideoEditEncodeSample { timestamp: number; duration: number; keyFrame: boolean }
/** 一份编码结果（时间为微秒，与 EncodedVideoChunk 相同），按编码器输出顺序交回界面线程。 */
export interface VideoEditEncodedChunk { data: ArrayBuffer; type: 'key' | 'delta'; timestamp: number; duration?: number; decoderConfig?: VideoDecoderConfig }
/** 一帧送进编码器的各段耗时：构造 VideoFrame（含缩放）、提交编码、等编码器队列空出。 */
export interface VideoEditFrameEncodeTiming { copyMs: number; encodeMs: number; encodeWaitMs: number; encodeQueue: number }

function copyBytes(source: AllowSharedBufferSource): ArrayBuffer {
  const view = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source)
  return view.slice().buffer
}
/** 跨线程交出的解码配置只含可结构化克隆的普通值。 */
function plainDecoderConfig(config: VideoDecoderConfig): VideoDecoderConfig {
  const { description, colorSpace, ...rest } = config
  return { ...rest, ...(description ? { description: copyBytes(description) } : {}),
    ...(colorSpace ? { colorSpace: { primaries: colorSpace.primaries, transfer: colorSpace.transfer, matrix: colorSpace.matrix, fullRange: colorSpace.fullRange } } : {}) }
}
function encodedChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): VideoEditEncodedChunk {
  const data = new ArrayBuffer(chunk.byteLength)
  chunk.copyTo(data)
  return { data, type: chunk.type, timestamp: chunk.timestamp, ...(chunk.duration !== null ? { duration: chunk.duration } : {}), ...(meta?.decoderConfig ? { decoderConfig: plainDecoderConfig(meta.decoderConfig) } : {}) }
}

export class VideoEditFrameEncoder {
  /** 渲染线程与界面线程的编码支持同源；这里再确认一次，不支持时给出原因而不是等编码器异步报错。 */
  static async open(config: VideoEncoderConfig, geometry: VideoEditEncodeGeometry | undefined, deliver: (chunk: VideoEditEncodedChunk) => void): Promise<VideoEditFrameEncoder> {
    const support = await VideoEncoder.isConfigSupported(config)
    if (!support.supported) throw new VideoEditEncoderFailure('unsupported', `VideoEncoder.isConfigSupported 拒绝：${config.codec} · ${config.width} × ${config.height} · ${config.hardwareAcceleration ?? 'no-preference'} · ${config.bitrateMode ?? ''} ${config.bitrate ?? ''}`)
    return new VideoEditFrameEncoder(config, geometry, deliver)
  }
  private encoder: VideoEncoder
  private failure?: VideoEditEncoderFailure
  private reclaimed = false
  private closed = false
  /** 等编码器进展的调用（送帧背压、收尾）；编码器取帧、出结果、报错或关闭时全部唤醒重查。 */
  private readonly waiters = new Set<() => void>()
  /** 编码器最近一次取走帧、交出结果或收到新帧的时刻。 */
  private progressAt = performance.now()
  private scaled?: OffscreenCanvas
  private constructor(private readonly config: VideoEncoderConfig, private readonly geometry: VideoEditEncodeGeometry | undefined, private readonly deliver: (chunk: VideoEditEncodedChunk) => void) {
    this.encoder = this.create()
  }
  private create(): VideoEncoder {
    const encoder = new VideoEncoder({
      output: (chunk, meta) => { this.progressAt = performance.now(); if (!this.closed) this.deliver(encodedChunk(chunk, meta)) },
      error: error => {
        // 浏览器回收闲置太久的编码器（窗口在后台时一帧算了很久）：队列已空、没有丢帧，下一帧换新编码器从关键帧接着编。
        if (error instanceof DOMException && error.name === 'QuotaExceededError' && /reclaimed/i.test(error.message)) this.reclaimed = true
        else this.failure ??= new VideoEditEncoderFailure('failed', error.message, { cause: error })
        this.wake()
      },
    })
    encoder.addEventListener('dequeue', () => { this.progressAt = performance.now(); this.wake() })
    encoder.configure(this.config)
    return encoder
  }
  private wake(): void { for (const waiter of [...this.waiters]) waiter() }
  private assertOpen(): void {
    if (this.failure) throw this.failure
    if (this.closed) throw new DOMException('视频编码已停止。', 'AbortError')
  }
  /** 等到 `done()` 成立；编码器在 `VIDEO_EDIT_ENCODER_STALL_MS` 内毫无进展就判定卡住、停止编码并抛出。 */
  private async waitForEncoder(done: () => boolean, stage: string): Promise<void> {
    while (!done() && !this.closed && !this.failure) {
      const idle = performance.now() - this.progressAt
      if (idle >= VIDEO_EDIT_ENCODER_STALL_MS) {
        this.failure = new VideoEditEncoderFailure('stalled', `${stage}时编码器 ${Math.round(idle / 1000)} 秒没有进展（队列 ${this.encoder.encodeQueueSize} 帧，${this.config.codec}，${this.config.hardwareAcceleration ?? 'no-preference'}）`)
        this.close()
        break
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      let waiter!: () => void
      await new Promise<void>(resolve => { waiter = resolve; this.waiters.add(resolve); timer = setTimeout(resolve, VIDEO_EDIT_ENCODER_STALL_MS - idle) })
      this.waiters.delete(waiter); clearTimeout(timer)
    }
    this.assertOpen()
  }
  /** 输出画幅不同的成片按导出几何画进 Worker 里的黑底 2D 画布（drawImage 的默认重采样），再交出位图。 */
  private scale(picture: ImageBitmap, geometry: VideoEditEncodeGeometry): ImageBitmap {
    const canvas = this.scaled ??= new OffscreenCanvas(geometry.width, geometry.height)
    const context = canvas.getContext('2d')!
    const { source: s, destination: d } = geometry
    context.fillStyle = BLACK_HEX; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(picture, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
    return canvas.transferToImageBitmap()
  }
  /**
   * 送进一帧（接管并关闭 `picture`）。返回时这一帧已在编码器队列里，且队列短于上限：调用方据此开始合成下一帧。
   * 时间换算与 mediabunny 从画布取帧相同（秒乘一百万后截断）。
   */
  async encode(picture: ImageBitmap, sample: VideoEditEncodeSample): Promise<VideoEditFrameEncodeTiming> {
    const copyStarted = performance.now()
    let source = picture
    let frame: VideoFrame
    try {
      this.assertOpen()
      if (this.geometry) source = this.scale(picture, this.geometry)
      frame = new VideoFrame(source, { timestamp: Math.trunc(sample.timestamp * 1e6), duration: Math.trunc(sample.duration * 1e6) || undefined })
    } finally {
      picture.close()
      if (source !== picture) source.close()
    }
    const encodeStarted = performance.now()
    try {
      let keyFrame = sample.keyFrame
      if (this.reclaimed) { this.reclaimed = false; this.encoder = this.create(); keyFrame = true }
      this.encoder.encode(frame, { keyFrame })
      this.progressAt = performance.now()
    } finally { frame.close() }
    const encodeQueue = this.encoder.encodeQueueSize
    const waitStarted = performance.now()
    await this.waitForEncoder(() => this.encoder.encodeQueueSize < VIDEO_EDIT_ENCODE_QUEUE_LIMIT, '送帧')
    return { copyMs: encodeStarted - copyStarted, encodeMs: waitStarted - encodeStarted, encodeWaitMs: performance.now() - waitStarted, encodeQueue }
  }
  /** 等全部编码结果交出（交出的消息都排在这次返回之前），然后关闭。 */
  async flush(): Promise<void> {
    this.assertOpen()
    // 被回收的编码器回收前队列已空，没有待交的结果。
    if (!this.reclaimed) {
      let flushed = false
      this.progressAt = performance.now()
      // 取消（close）使收尾以 AbortError 结束，那不是编码器出错。
      this.encoder.flush().then(() => { flushed = true; this.wake() }, (error: Error) => { if (!this.closed) this.failure ??= new VideoEditEncoderFailure('failed', error.message, { cause: error }); this.wake() })
      await this.waitForEncoder(() => flushed, '收尾')
    }
    this.close()
  }
  /** 立即停止：排队的帧随编码器一起丢弃，等背压的一帧随即返回。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.encoder.state !== 'closed') this.encoder.close()
    this.wake()
    if (this.scaled) { this.scaled.width = this.scaled.height = 1; this.scaled = undefined }
  }
}
