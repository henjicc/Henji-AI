import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ScreenCaptureBackend, ScreenCaptureOptions, CaptureSpan } from '../../../../../src/core/screenRecording/capture'
import { captureCrop } from '../../../../../src/core/screenRecording/capture'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import { getPreferredEncoder, invalidateEncoderCache, type VideoEncoderProfile } from '../../video/hwaccel'
import { createMainLogger } from '../../logging'
import { assertCaptureDiskSpace, type CaptureStorage } from './storage'
import { spawnCaptureProcess } from './process'

const logger = createMainLogger('main.screen_recording.capture')
export interface NativeCaptureSource { selector: 'hwnd' | 'hmonitor'; handle: string; width: number; height: number }
export function buildGfxCaptureArgs(options: ScreenCaptureOptions, source: NativeCaptureSource, encoder: VideoEncoderProfile, output: string): string[] {
  if (!/^\d+$/.test(source.handle) || source.handle === '0') throw new Error('录制来源已失效，请重新选择')
  const crop = captureCrop(options.region, source.width, source.height)
  const filter = `gfxcapture=${source.selector}=${source.handle}:capture_cursor=${options.cursor === 'embed' ? 1 : 0}:capture_border=1:max_framerate=${options.fps}:width=${options.width}:height=${options.height}:resize_mode=scale_aspect`
    + (options.region ? `:crop_left=${crop.x}:crop_top=${crop.y}:crop_right=${source.width - crop.x - crop.width}:crop_bottom=${source.height - crop.y - crop.height}` : '')
    + (encoder.id === 'cpu' ? ',hwdownload,format=bgra,format=yuv420p' : '')
  const kbps = Math.round(options.bitrate / 1000)
  return ['-hide_banner', '-loglevel', 'warning', '-stats_period', '0.25', '-filter_complex', `${filter}[screen]`, '-map', '[screen]', '-an',
    ...encoder.buildEncodeArgs(kbps, kbps * 1.5, kbps * 2), '-g', String(options.fps), '-bf', '0',
    '-fps_mode', 'vfr', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-flush_packets', '1', '-progress', 'pipe:1', '-n', output]
}
interface GfxDependencies {
  binary(): Promise<string>
  encoder(): Promise<VideoEncoderProfile>
  spawn(binary: string, args: string[]): ChildProcessWithoutNullStreams
  nowUs(): number
  failed(error: Error): void
}
interface Run { process: ChildProcessWithoutNullStreams; closed: Promise<void>; ready: Promise<void>; span: CaptureSpan; expected: boolean; durationUs: number }
/** WGC owns acquisition; FFmpeg owns pixel conversion/encoding. Main only coordinates I/O. */
export class GfxCaptureBackend implements ScreenCaptureBackend {
  private run: Run | null = null
  private binary = ''
  private encoder: VideoEncoderProfile | null = null
  private cancelled = false
  private pending: Promise<void> = Promise.resolve()
  private watchdog: ReturnType<typeof setInterval> | undefined
  private readonly deps: GfxDependencies
  constructor(private readonly options: ScreenCaptureOptions, private readonly source: NativeCaptureSource, private readonly storage: CaptureStorage, deps: Partial<GfxDependencies> & Pick<GfxDependencies, 'nowUs' | 'failed'>) {
    this.deps = { binary: loadFfmpegPath, encoder: getPreferredEncoder, spawn: spawnCaptureProcess, ...deps }
  }
  async prepare(): Promise<void> { this.binary = await this.deps.binary(); this.encoder = await this.deps.encoder() }
  start(signal: AbortSignal): Promise<void> {
    const work = async (): Promise<void> => {
      signal.throwIfAborted(); if (this.cancelled) throw new Error('录制已取消')
      await assertCaptureDiskSpace(this.storage.directory)
      const encoder = this.encoder!
      try { await this.launch(encoder, signal) } catch (error) {
        await this.end(false)
        if (signal.aborted || this.cancelled || encoder.id === 'cpu') throw error
        logger.warn('硬件录制未能启动，改用软件编码', { event: 'recording.capture.encoder.fallback', error, context: { encoder: encoder.id } })
        void invalidateEncoderCache().catch(failure => logger.warn('编码器重新探测失败', { event: 'recording.capture.encoder.probe_failed', error: failure }))
        this.encoder = { id: 'cpu', label: 'CPU', buildEncodeArgs: (kbps) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', `${kbps}k`] }
        await this.launch(this.encoder, signal)
      }
      signal.throwIfAborted(); if (this.cancelled) { await this.end(false); throw new Error('录制已取消') }
      this.watchdog = setInterval(() => { void assertCaptureDiskSpace(this.storage.directory).catch(error => this.fail(error)) }, 2000)
      this.watchdog.unref?.()
    }
    this.pending = work()
    return this.pending
  }
  private async launch(encoder: VideoEncoderProfile, signal: AbortSignal): Promise<void> {
    const span = await this.storage.openSpan(this.deps.nowUs(), true)
    signal.throwIfAborted(); if (this.cancelled) throw new Error('录制已取消')
    const child = this.deps.spawn(this.binary, buildGfxCaptureArgs(this.options, this.source, encoder, this.storage.file(span)))
    let readyResolve!: () => void, readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    let closeResolve!: () => void
    const closed = new Promise<void>(resolve => { closeResolve = resolve })
    const run: Run = { process: child, ready, closed, span, expected: false, durationUs: 0 }
    this.run = run
    let stdout = '', stderr = '', started = false
    const timeout = setTimeout(() => { readyReject(new Error('屏幕采集启动超时，请检查来源或改用兼容录制')); child.kill() }, 15000)
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4096) })
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      let newline: number
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim(); stdout = stdout.slice(newline + 1)
        if (line.startsWith('out_time_us=')) {
          const time = Number(line.slice(12))
          if (Number.isFinite(time) && time > 0) {
            run.durationUs = time
            if (!started) { started = true; clearTimeout(timeout); span.monoUs = Math.max(0, this.deps.nowUs() - time); readyResolve() }
          }
        }
      }
    })
    child.once('error', error => { readyReject(error) })
    // exit only signals process termination; close is the pipe/resource release barrier.
    child.once('close', code => {
      clearTimeout(timeout); closeResolve()
      if (!started) readyReject(new Error(`屏幕采集未能启动（${code ?? '异常退出'}）：${stderr}`))
      else if (!run.expected) this.fail(new Error(`屏幕采集意外结束（${code ?? '异常退出'}），已写片段可以恢复。`))
    })
    await ready
    await this.storage.save()
    logger.info('屏幕采集开始', { event: 'recording.capture.start', context: { encoder: encoder.id, width: this.options.width, height: this.options.height, fps: this.options.fps } })
  }
  private fail(error: Error): void {
    clearInterval(this.watchdog)
    this.deps.failed(error)
    void this.end(false).catch(failure => logger.error('录制清理失败', { event: 'recording.capture.cleanup.failed', error: failure }))
  }
  private async end(finalize: boolean): Promise<void> {
    clearInterval(this.watchdog)
    const run = this.run
    if (!run) return
    run.expected = true
    if (run.process.exitCode === null && run.process.signalCode === null) {
      run.process.stdin.on('error', () => undefined) // EPIPE during normal process teardown.
      run.process.stdin.end('q\n')
    }
    const kill = setTimeout(() => run.process.kill(), 5000)
    await run.closed; clearTimeout(kill)
    if (this.run === run) this.run = null
    if (finalize && run.durationUs > 0) await this.storage.seal(run.span.index, run.durationUs)
  }
  async pause(signal: AbortSignal): Promise<void> { signal.throwIfAborted(); await this.end(true) }
  resume(signal: AbortSignal): Promise<void> { return this.start(signal) }
  async stop(_signal: AbortSignal): Promise<void> { await this.end(true) }
  async cancel(): Promise<void> { this.cancelled = true; await this.end(false); await this.pending.catch(() => undefined); await this.end(false) }
}
