import { recordingEncoding, recordingKeyframes } from '../../../../../src/core/screenRecording/encoding'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ScreenCaptureBackend, ScreenCaptureOptions, CaptureSpan } from '../../../../../src/core/screenRecording/capture'
import { captureCrop } from '../../../../../src/core/screenRecording/capture'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import { getRecordingEncoder, recordingEncoderProfile, invalidateEncoderCache, type VideoEncoderProfile, type HwEncoderId } from '../../video/hwaccel'
import { createMainLogger } from '../../logging'
import { assertCaptureDiskSpace, type CaptureStorage } from './storage'
import { spawnCaptureProcess } from './process'

const logger = createMainLogger('main.screen_recording.capture')
export interface NativeCaptureSource { selector: 'hwnd' | 'hmonitor'; handle: string; width: number; height: number }
/**
 * 采集一出帧就把它相对第一帧的时刻打到 stderr（错误级，-loglevel warning 下也会输出），不等编码与封装。
 * gfxcapture 只给相对第一帧的时间戳、拿不到系统时刻，第一帧的会话时刻只能用“到达时刻 − 帧时刻”的最小值估；
 * 在采集之后立即打点，估计里不含编码器与封装的排队（实测比按编码进度估早约 10–15 ms，与真实合成时刻差一帧以内）。
 */
const FRAME_TIME_PRINT = String.raw`,setpts='PTS+0*print(PTS*TB\,16)'`
const FRAME_TIME_LINE = /^\[Eval @ [^\]]+\] (\d+(?:\.\d+)?)$/
export function buildGfxCaptureArgs(options: ScreenCaptureOptions, source: NativeCaptureSource, encoder: VideoEncoderProfile<HwEncoderId | 'cpu'>, output: string, embedCursor = false): string[] {
  if (!/^\d+$/.test(source.handle) || source.handle === '0') throw new Error('录制来源已失效，请重新选择')
  const crop = captureCrop(options.region, source.width, source.height)
  const filter = `gfxcapture=${source.selector}=${source.handle}:capture_cursor=${embedCursor ? 1 : 0}:capture_border=1:max_framerate=${options.fps}:width=${options.width}:height=${options.height}:resize_mode=scale_aspect`
    + (options.region ? `:crop_left=${crop.x}:crop_top=${crop.y}:crop_right=${source.width - crop.x - crop.width}:crop_bottom=${source.height - crop.y - crop.height}` : '')
    + FRAME_TIME_PRINT
    + (encoder.id === 'cpu' ? ',hwdownload,format=bgra,format=yuv420p' : '')
  const encoding = recordingEncoding(options)
  const kbps = Math.round(encoding.bitrate / 1000)
  return ['-hide_banner', '-loglevel', 'warning', '-stats_period', '0.25', '-filter_complex', `${filter}[screen]`, '-map', '[screen]', '-an',
    ...encoder.buildEncodeArgs(kbps, kbps * (encoding.rateControl === 'vbr' ? 1.5 : 1), kbps * 2), '-g', String(recordingKeyframes(encoding.keyframeFrames).gop), '-bf', '0',
    '-r', String(options.fps), '-fps_mode', 'cfr', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-flush_packets', '1', '-progress', 'pipe:1', '-n', output]
}
interface GfxDependencies {
  binary(): Promise<string>
  encoder(): Promise<VideoEncoderProfile<HwEncoderId | 'cpu'>>
  spawn(binary: string, args: string[]): ChildProcessWithoutNullStreams
  nowUs(): number
  failed(error: Error): void
  /** 编码进程意外退出后已在新分片里接着录。 */
  restarted?(info: { restarts: number; encoder: string; reason: string }): void
  /** 确认被录的窗口或显示器已经没了（显示器要连续几次都查不到）；不提供时当作还在。 */
  sourceGone?(): Promise<boolean>
  /** 来源没了（窗口关闭、显示器拔出），画面到此为止且已封口；由调用方按停止收尾。 */
  sourceEnded?(): void
}
/** endOfStream：进程自己报了 progress=end，即采集源给出了结尾（gfxcapture 在被录窗口关闭后约 70 ms 以退出码 0 结束）。 */
interface Run { process: ChildProcessWithoutNullStreams; closed: Promise<void>; ready: Promise<void>; span: CaptureSpan; expected: boolean; durationUs: number; dropped: number; duplicated: number; stderr: string; endOfStream: boolean }
export interface GfxCaptureStats { restarts: number; droppedFrames: number; duplicatedFrames: number; encoder: string }
/** 一分钟内续录超过这么多次，说明来源或显卡已经起不来了，停下来保住已录部分。 */
const MAX_RESTARTS_PER_MINUTE = 5
/** WGC owns acquisition; FFmpeg owns pixel conversion/encoding. Main only coordinates I/O. */
export class GfxCaptureBackend implements ScreenCaptureBackend {
  private run: Run | null = null
  private binary = ''
  private encoder: VideoEncoderProfile<HwEncoderId | 'cpu'> | null = null
  private cancelled = false
  private pending: Promise<void> = Promise.resolve()
  /** 开始、暂停、停止与意外退出后的续录依次执行，任何时刻最多一个编码进程。 */
  private serial: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly restartTimes: number[] = []
  private totals = { restarts: 0, droppedFrames: 0, duplicatedFrames: 0 }
  private watchdog: ReturnType<typeof setInterval> | undefined
  private readonly deps: GfxDependencies
  constructor(private readonly options: ScreenCaptureOptions, private readonly source: NativeCaptureSource, private readonly storage: CaptureStorage, deps: Partial<GfxDependencies> & Pick<GfxDependencies, 'nowUs' | 'failed'>, private readonly embedCursor = false) {
    this.deps = { binary: loadFfmpegPath, encoder: () => getRecordingEncoder(recordingEncoding(options)), spawn: spawnCaptureProcess, ...deps }
  }
  stats(): GfxCaptureStats {
    return { restarts: this.totals.restarts, droppedFrames: this.totals.droppedFrames + (this.run?.dropped ?? 0), duplicatedFrames: this.totals.duplicatedFrames + (this.run?.duplicated ?? 0), encoder: this.encoder?.id ?? '' }
  }
  async prepare(): Promise<void> {
    this.binary = await this.deps.binary(); this.encoder = await this.deps.encoder()
    if (this.encoder.id === 'cpu' && this.options.encoder !== 'software') logger.warn('硬件编码不可用，已改用软件编码', { event: 'recording.capture.encoder.fallback', context: { requested: this.options.encoder ?? 'auto', codec: this.options.codec ?? 'h264' } })
  }
  private serialize(work: () => Promise<void>): Promise<void> {
    const next = this.serial.then(work)
    this.serial = next.catch(() => undefined)
    return next
  }
  start(signal: AbortSignal): Promise<void> {
    this.pending = this.serialize(async () => {
      signal.throwIfAborted(); if (this.cancelled) throw new Error('录制已取消')
      await assertCaptureDiskSpace(this.storage.directory)
      await this.launchWithFallback(signal)
      signal.throwIfAborted(); if (this.cancelled) { await this.end(false); throw new Error('录制已取消') }
    })
    return this.pending
  }
  /** 硬件编码起不来就退回软件编码；H.265 软件编码也起不来再退回 H.264。 */
  private async launchWithFallback(signal: AbortSignal): Promise<void> {
    const encoder = this.encoder!
    try { await this.launch(encoder, signal) } catch (error) {
      await this.end(false)
      if (signal.aborted || this.cancelled || encoder.id === 'cpu' && this.options.codec !== 'hevc') throw error
      logger.warn('硬件录制未能启动，改用软件编码', { event: 'recording.capture.encoder.fallback', error, context: { encoder: encoder.id } })
      void invalidateEncoderCache().catch(failure => logger.warn('编码器重新探测失败', { event: 'recording.capture.encoder.probe_failed', error: failure }))
      this.encoder = recordingEncoderProfile(this.options.codec ?? 'h264', 'software', this.options.rateControl ?? 'quality', recordingKeyframes(recordingEncoding(this.options).keyframeFrames).sceneCut)
      this.storage.manifest.encoding = { codec: this.options.codec ?? 'h264', encoder: 'software', softwareFallback: true, reason: '硬件编码未能启动，已改用软件编码' }
      try { await this.launch(this.encoder, signal) }
      catch (failure) {
        await this.end(false)
        if (signal.aborted || this.cancelled || this.options.codec !== 'hevc') throw failure
        logger.warn('H.265 编码不可用，改用 H.264 软件编码', { event: 'recording.capture.codec.fallback', error: failure })
        this.encoder = recordingEncoderProfile('h264', 'software', this.options.rateControl ?? 'quality', recordingKeyframes(recordingEncoding(this.options).keyframeFrames).sceneCut)
        this.storage.manifest.encoding = { codec: 'h264', encoder: 'software', softwareFallback: this.options.encoder !== 'software', reason: 'H.265 编码不可用，已改用 H.264 软件编码' }
        await this.launch(this.encoder, signal)
      }
    }
    clearInterval(this.watchdog)
    this.watchdog = setInterval(() => { void assertCaptureDiskSpace(this.storage.directory).catch(error => this.fail(error)) }, 2000)
    this.watchdog.unref?.()
  }
  private async launch(encoder: VideoEncoderProfile<HwEncoderId | 'cpu'>, signal: AbortSignal): Promise<void> {
    const span = await this.storage.openSpan(this.deps.nowUs(), true)
    signal.throwIfAborted(); if (this.cancelled) throw new Error('录制已取消')
    const child = this.deps.spawn(this.binary, buildGfxCaptureArgs(this.options, this.source, encoder, this.storage.file(span), this.embedCursor))
    let readyResolve!: () => void, readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    let closeResolve!: () => void
    const closed = new Promise<void>(resolve => { closeResolve = resolve })
    const run: Run = { process: child, ready, closed, span, expected: false, durationUs: 0, dropped: 0, duplicated: 0, stderr: '', endOfStream: false }
    this.run = run
    let stdout = '', stderr = '', started = false, firstFrameUs = Number.POSITIVE_INFINITY
    // 每个估计都比第一帧的真实时刻晚（晚多少看排队），取最早的一个。
    const estimate = (timeUs: number): void => {
      const value = Math.max(0, this.deps.nowUs() - timeUs)
      if (!started) firstFrameUs = Math.min(firstFrameUs, value)
      else if (value < span.monoUs && !span.finalized) span.monoUs = value
    }
    const timeout = setTimeout(() => { readyReject(new Error('屏幕采集启动超时，请检查来源或改用兼容录制')); child.kill() }, 15000)
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      let newline: number
      while ((newline = stderr.indexOf('\n')) >= 0) {
        const line = stderr.slice(0, newline).trim(); stderr = stderr.slice(newline + 1)
        const frame = FRAME_TIME_LINE.exec(line)
        if (frame) estimate(Math.round(Number(frame[1]) * 1e6))
        else if (line) run.stderr = `${run.stderr}${line}\n`.slice(-4096)
      }
    })
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      let newline: number
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim(); stdout = stdout.slice(newline + 1)
        // -progress 的帧计数在一个编码进程内累计。
        if (line.startsWith('drop_frames=')) run.dropped = Number(line.slice(12)) || run.dropped
        else if (line.startsWith('dup_frames=')) run.duplicated = Number(line.slice(11)) || run.duplicated
        else if (line === 'progress=end') run.endOfStream = true
        else if (line.startsWith('out_time_us=')) {
          const time = Number(line.slice(12))
          if (Number.isFinite(time) && time > 0) {
            run.durationUs = time
            // 编码进度也是一个（更晚的）估计：采集打点没出来时（例如外部替身）仍能定下起点。
            estimate(time)
            if (!started) { started = true; clearTimeout(timeout); span.monoUs = Math.round(firstFrameUs); readyResolve() }
          }
        }
      }
    })
    child.once('error', error => { readyReject(error) })
    // exit only signals process termination; close is the pipe/resource release barrier.
    child.once('close', code => {
      clearTimeout(timeout); closeResolve()
      if (!started) readyReject(new Error(`屏幕采集未能启动（${code ?? '异常退出'}）：${run.stderr}`))
      else if (!run.expected) void this.serialize(() => this.restart(run, code)).catch(error => this.fail(error instanceof Error ? error : new Error(String(error))))
    })
    await ready
    this.storage.manifest.encoding ??= { codec: this.options.codec ?? 'h264', encoder: encoder.id === 'cpu' ? 'software' : encoder.id, softwareFallback: encoder.id === 'cpu' && this.options.encoder !== 'software', ...(encoder.id === 'cpu' && this.options.encoder !== 'software' ? { reason: '硬件编码不可用，已改用软件编码' } : {}) }
    await this.storage.save()
    logger.info('屏幕采集开始', { event: 'recording.capture.start', context: { encoder: encoder.id, width: this.options.width, height: this.options.height, fps: this.options.fps } })
  }
  /**
   * 编码进程意外退出（显卡驱动重置、编码会话数满等）：按原参数在新分片里接着录，硬件起不来就退回软件编码。
   * 退出的那一片不按进度报的时长封口（最后一个没写完的片段已经丢了），留给收尾按文件里真实的画面算；
   * 两片之间重启的那一两秒没有画面，如实留空。
   */
  private async restart(run: Run, code: number | null): Promise<void> {
    if (this.cancelled || this.run !== run) return
    this.run = null
    clearInterval(this.watchdog)
    this.collect(run)
    // 进程报了结尾、来源也确认没了：录制到此为止，对着不在的窗口续录只会一次次起不来。这一片完整写到了结尾，按进度封口后交给停止收尾。
    // 只报了结尾而来源还在（或查不准）照常续录，宁可多续一次也不把正常的长录停掉。
    if (run.endOfStream && await this.sourceGone()) {
      if (this.cancelled) return
      logger.info('录制来源已关闭，画面到此为止', { event: 'recording.capture.source.ended', context: { code, durationUs: run.durationUs } })
      if (run.durationUs > 0) await this.storage.seal(run.span.index, run.durationUs)
      this.deps.sourceEnded?.()
      return
    }
    if (this.cancelled) return
    const now = Date.now()
    this.restartTimes.push(now)
    while (this.restartTimes[0] < now - 60_000) this.restartTimes.shift()
    const reason = `屏幕采集意外结束（${code ?? '异常退出'}）`
    logger.warn('屏幕采集意外结束，自动续录', { event: 'recording.capture.restart.start', context: { code, restarts: this.totals.restarts, encoder: this.encoder?.id, stderr: run.stderr.slice(-1000) } })
    if (this.restartTimes.length > MAX_RESTARTS_PER_MINUTE) throw new Error(`${reason}，一分钟内多次续录都没能恢复，录制已停止；已录部分可以导入。`)
    await assertCaptureDiskSpace(this.storage.directory)
    try { await this.launchWithFallback(this.lifetime.signal) } catch (error) {
      // 退出时来源还在、续录途中才没的：同样是录制到此为止，不当成失败。
      if (this.cancelled || !await this.sourceGone()) throw error
      logger.info('续录时录制来源已关闭，画面到此为止', { event: 'recording.capture.source.ended', context: { code } })
      this.deps.sourceEnded?.()
      return
    }
    if (this.cancelled) { await this.end(false); return }
    this.totals.restarts++
    logger.info('屏幕采集已续录', { event: 'recording.capture.restart.completed', context: { restarts: this.totals.restarts, encoder: this.encoder?.id } })
    this.deps.restarted?.({ restarts: this.totals.restarts, encoder: this.encoder?.id ?? '', reason })
  }
  private async sourceGone(): Promise<boolean> { return await this.deps.sourceGone?.() ?? false }
  private collect(run: Run): void { this.totals.droppedFrames += run.dropped; this.totals.duplicatedFrames += run.duplicated; run.dropped = 0; run.duplicated = 0 }
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
    if (this.run === run) { this.run = null; this.collect(run) }
    if (finalize && run.durationUs > 0) await this.storage.seal(run.span.index, run.durationUs)
  }
  pause(signal: AbortSignal): Promise<void> { return this.serialize(async () => { signal.throwIfAborted(); await this.end(true) }) }
  resume(signal: AbortSignal): Promise<void> { return this.start(signal) }
  stop(_signal: AbortSignal): Promise<void> { return this.serialize(() => this.end(true)) }
  async cancel(): Promise<void> {
    this.cancelled = true; this.lifetime.abort()
    await this.end(false); await this.pending.catch(() => undefined); await this.serial; await this.end(false)
  }
}
