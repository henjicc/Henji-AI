import { recordingEncoding } from '@/core/screenRecording/encoding'
import type { CaptureManifest } from '@/core/screenRecording/capture'
import { Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSource } from 'mediabunny'
import { captureCrop, type CaptureSpan, type ScreenCaptureBackend, type ScreenCaptureOptions } from '@/core/screenRecording/capture'
import { selectVideoEditExportEncoder, videoEditExportVideoOptions } from '@/features/videoEdit'
import { createLogger } from '@/core/logging'
import { CaptureFrameClock } from '@/core/screenRecording/frameClock'

const logger = createLogger('features.screenRecording.capture')
export interface CaptureSink {
  encoding?(value: NonNullable<CaptureManifest['encoding']>): Promise<void>
  clock(): Promise<number>
  anchor(index: number, monoUs: number): Promise<void>
  open(): Promise<CaptureSpan>
  write(index: number, position: number, data: Uint8Array): Promise<void>
  seal(index: number, durationUs: number): Promise<void>
  failed(error: Error): void
}
interface CaptureReader { read(): Promise<ReadableStreamReadResult<VideoFrame>>; cancel(): Promise<void>; releaseLock(): void }
export interface CaptureMuxer { add(frame: VideoFrame, timeSeconds: number): Promise<void>; finish(): Promise<void>; cancel(): Promise<void> }
export interface ChromiumDependencies {
  stream(options: ScreenCaptureOptions, audio?: boolean): Promise<MediaStream>
  reader(track: MediaStreamTrack): CaptureReader
  mux(options: ScreenCaptureOptions, span: CaptureSpan, sink: CaptureSink): Promise<CaptureMuxer>
}
async function createMux(options: ScreenCaptureOptions, span: CaptureSpan, sink: CaptureSink): Promise<CaptureMuxer> {
  const encoding = recordingEncoding(options)
  const bitrateMode = encoding.rateControl === 'cbr' ? 'cbr' : 'vbr'
  const spec = { width: options.width, height: options.height, frameRate: options.fps, bitrate: encoding.bitrate, bitrateMode } as const
  let encoderPreference: 'hardware' | 'software' = encoding.encoder === 'software' ? 'software' : 'hardware'
  let codec: 'avc' | 'hevc' = encoding.codec === 'hevc' ? 'hevc' : 'avc'
  try { await selectVideoEditExportEncoder({ ...spec, codec, encoderPreference }) }
  catch (error) {
    if (codec === 'hevc') {
      codec = 'avc'
      logger.warn('当前设备不支持 H.265 录制，改用 H.264', { event: 'recording.capture.codec.fallback', error })
    }
    try { await selectVideoEditExportEncoder({ ...spec, codec, encoderPreference }) }
    catch (failure) {
      encoderPreference = 'software'
      logger.warn('兼容录制已改用软件编码', { event: 'recording.capture.encoder.fallback', error: failure })
      await selectVideoEditExportEncoder({ ...spec, codec, encoderPreference })
    }
  }
  if (encoding.rateControl === 'quality' || !['auto', 'software'].includes(encoding.encoder)) logger.info('兼容路径按 WebCodecs 可用码率与硬件选择能力录制', { event: 'recording.capture.encoding.adapted', context: { rateControl: encoding.rateControl, encoder: encoding.encoder, bitrateMode } })
  await sink.encoding?.({ codec: codec === 'avc' ? 'h264' : 'hevc', encoder: encoderPreference, softwareFallback: encoderPreference === 'software' && encoding.encoder !== 'software' })
  const source = new VideoSampleSource(videoEditExportVideoOptions({ codec, width: options.width, height: options.height, fps: options.fps, videoBitrateMbps: encoding.bitrate / 1_000_000, bitrateMode, encoderPreference, keyframeInterval: encoding.keyframeFrames / options.fps, latencyMode: 'realtime' }))
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }), target: new StreamTarget(new WritableStream({ write: chunk => sink.write(span.index, chunk.position, chunk.data) }), { chunked: true, chunkSize: 1024 * 1024 }) })
  output.addVideoTrack(source, { frameRate: options.fps })
  await output.start()
  // A bounded canvas is only needed for crop/scale; native-size frames avoid a pixel copy.
  let canvas: OffscreenCanvas | undefined
  return {
    add: async (frame, timestamp) => {
      const crop = captureCrop(options.region, frame.displayWidth, frame.displayHeight)
      let sample: VideoSample
      if (options.region || frame.displayWidth !== options.width || frame.displayHeight !== options.height) {
        canvas ??= new OffscreenCanvas(options.width, options.height)
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('无法准备录制画面')
        const scale = Math.min(options.width / crop.width, options.height / crop.height)
        const width = crop.width * scale, height = crop.height * scale
        context.clearRect(0, 0, options.width, options.height)
        context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, (options.width - width) / 2, (options.height - height) / 2, width, height)
        sample = new VideoSample(canvas, { timestamp, duration: 1 / options.fps })
      } else sample = new VideoSample(frame, { timestamp, duration: 1 / options.fps })
      try { await source.add(sample) } finally { sample.close() }
    },
    finish: async () => { source.close(); await output.finalize() },
    cancel: async () => { source.close(); await output.cancel() },
  }
}
const browserDependencies: ChromiumDependencies = {
  stream: (options, audio = false) => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: options.fps, max: options.fps } }, audio }),
  reader: track => {
    const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: new (input: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor
    if (!Processor) throw new Error('当前环境无法读取屏幕帧，请更新应用后重试')
    return new Processor({ track, maxBufferSize: 1 }).readable.getReader()
  },
  mux: createMux,
}

/** One frame in flight; encoder and disk backpressure bound memory for arbitrarily long captures. */
export class ChromiumCaptureBackend implements ScreenCaptureBackend {
  private stream: MediaStream | null = null
  private reader: CaptureReader | null = null
  private mux: CaptureMuxer | null = null
  private span: CaptureSpan | null = null
  private pump: Promise<void> = Promise.resolve()
  private preparing: Promise<void> = Promise.resolve()
  private cancelled = false
  private running = false
  private durationUs = 0
  constructor(private readonly options: ScreenCaptureOptions, private readonly sink: CaptureSink, private readonly deps: ChromiumDependencies = browserDependencies, private readonly systemAudio = false) {}
  async cloneAudio(): Promise<MediaStream> {
    await this.preparing
    const tracks = this.stream?.getAudioTracks() ?? []
    if (!tracks.length) throw new Error('当前来源没有提供系统声音，请检查权限或关闭系统声音后重试')
    return new MediaStream(tracks.map(track => { const clone = track.clone(); clone.enabled = true; return clone }))
  }
  prepare(): Promise<void> {
    this.preparing = this.deps.stream(this.options, this.systemAudio).then(stream => {
      if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); throw new Error('录制已取消') }
      if (!stream.getVideoTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('没有可录制的屏幕画面') }
      this.stream = stream
      for (const track of stream.getTracks()) {
        track.enabled = false
        track.addEventListener('ended', () => { if (!this.cancelled) this.reportFailure(new Error('屏幕共享已结束，已保存的片段可以恢复')) })
      }
    })
    return this.preparing
  }
  async start(signal: AbortSignal): Promise<void> {
    await this.preparing
    signal.throwIfAborted()
    if (this.cancelled || !this.stream) throw new Error('请重新准备录制')
    this.span = await this.sink.open()
    this.mux = await this.deps.mux(this.options, this.span, this.sink)
    if (this.cancelled || signal.aborted) { await this.mux.cancel(); this.mux = null; signal.throwIfAborted(); throw new Error('录制已取消') }
    const track = this.stream.getVideoTracks()[0]
    track.enabled = true
    this.reader = this.deps.reader(track)
    this.running = true; this.durationUs = 0
    const reader = this.reader, mux = this.mux
    let first = -1, last = -1
    const clock = new CaptureFrameClock()
    this.pump = (async () => {
      while (this.running) {
        const { done, value: frame } = await reader.read()
        if (done) { if (this.running) throw new Error('屏幕帧流已结束'); break }
        try {
          if (!this.running) break
          if (clock.needsCalibration(frame.timestamp)) {
            const before = performance.now(), mono = await this.sink.clock(), after = performance.now()
            clock.calibrate(frame.timestamp, mono - Math.round((after - before) * 500), 1_000_000 / this.options.fps)
          }
          const monoUs = clock.map(frame.timestamp)
          if (first < 0) { first = monoUs; await this.sink.anchor(this.span!.index, first) }
          const time = monoUs - first
          // Frame timestamps are the media clock; never use polling/rAF as frame timestamps.
          if (time <= last || last >= 0 && time - last < 1_000_000 / this.options.fps - 500) continue
          await mux.add(frame, time / 1_000_000)
          last = time; this.durationUs = Math.round(time + 1_000_000 / this.options.fps)
        } finally { frame.close() }
      }
    })().catch(error => { this.reportFailure(error instanceof Error ? error : new Error(String(error))) })
    logger.info('兼容屏幕采集开始', { event: 'recording.capture.start', context: { cursorEmbedded: true, width: this.options.width, height: this.options.height } })
  }
  private reportFailure(error: Error): void {
    if (this.cancelled) return
    logger.error('兼容屏幕采集失败', { event: 'recording.capture.failed', error })
    this.sink.failed(error)
    void this.cancel().catch(failure => logger.error('兼容采集清理失败', { event: 'recording.capture.cleanup.failed', error: failure }))
  }
  private async end(finalize: boolean): Promise<void> {
    this.running = false
    this.stream?.getTracks().forEach(track => { track.enabled = false })
    const reader = this.reader; this.reader = null
    if (reader) { await reader.cancel(); await this.pump; reader.releaseLock() }
    const mux = this.mux; this.mux = null
    if (mux) {
      if (finalize) { await mux.finish(); await this.sink.seal(this.span!.index, this.durationUs) }
      else await mux.cancel()
    }
  }
  async pause(signal: AbortSignal): Promise<void> { signal.throwIfAborted(); await this.end(true) }
  resume(signal: AbortSignal): Promise<void> { return this.start(signal) }
  async stop(_signal: AbortSignal): Promise<void> { await this.end(true); this.release() }
  private release(): void { this.cancelled = true; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null }
  async cancel(): Promise<void> { this.release(); await this.preparing.catch(() => undefined); await this.end(false) }
}
