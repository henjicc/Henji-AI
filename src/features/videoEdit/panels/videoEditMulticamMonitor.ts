import { createLogger } from '@/core/logging'
import { activeVideoEditClips, videoEditDuration, type VideoEditClip, type VideoEditComposition, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditMulticamSource } from '@/core/videoEdit/multicam'
import { videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import { getActiveVideoEditSequence, listVideoEditInstances, subscribeVideoEditDomain, subscribeVideoEditView, videoEditProgramCommandIdentity, type VideoEditInstance } from '../application/videoEditService'
import { videoEditProgramMulticam } from '../application/videoEditMulticam'
import { getVideoEditProxySources } from '../application/videoEditProxy'
import { VideoEditPlaybackCollector } from '../application/videoEditPlaybackStats'
import { videoEditPlaybackTarget } from '../engine/videoEditDisplayClock'
import { VideoEditRenderBusyError } from '../engine/videoEditGpuFailure'
import { videoEditMulticamGrid, videoEditMulticamGridDivisor, videoEditMulticamProxyKey, type VideoEditMulticamGrid } from '../engine/videoEditMulticamGrid'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import type { RenderResponse } from '../engine/videoEditWorker'

const logger = createLogger('features.videoEdit.multicamPreview')
/** 同时交给网格会话的画面请求，与节目监视器相同：一帧等刷新时刻、一帧在准备、一帧等回执。 */
const FRAMES_IN_FLIGHT = 3
/** 正向播放已排进 Worker、还没提交给 GPU 的帧：一帧等刷新时，下一帧已排在它后面准备。 */
const UNSUBMITTED_FRAMES = 2
/** 暂停、拖动时同时在途的请求：Worker 会当场跳过排队中被更新请求取代的旧画面。 */
const PAUSED_IN_FLIGHT = 2
const BUSY_RETRY_MS = 4
/** 播放时钟跟随节目的速度：较早的观测直接采用（更接近节目的呈现时刻），较晚的按这个比例慢慢跟上。 */
const CLOCK_FOLLOW = .1

/**
 * 节目的播放时钟：节目每呈现一帧就把播放头设到这一帧，回执总比呈现时刻略晚。`zero` 是父序列第 0 帧按这条时钟应当呈现的时刻
 * （`performance.now()` 时基），由各次观测推算：起播第一帧不按时钟呈现，不参与。
 */
interface ProgramClock { command: object; rate: number; frame: number; zero?: number }
/** 一次连续正向播放：网格各帧按节目时钟的呈现时刻排进同一套顺序解码。 */
interface PlaybackRun { command: object; lastFrame: number; lastGrid: number; collector?: VideoEditPlaybackCollector; shownAt?: number }

export interface VideoEditMulticamMonitorEvents {
  /** 这个会话的第一帧网格画面已呈现。 */
  presented(): void
  /** 会话出错，监视器已停下并释放会话（渲染队列排满的背压不算）。 */
  failed(error: unknown): void
}

/**
 * 多机位监视器的出帧调度：一个渲染会话把全部机位合成为一张网格，Worker 直接画到各格子的画布。
 * 正向播放跟随节目时钟，按呈现时刻走顺序解码（与节目同一套播放路径）；暂停、拖动、倒放按播放头定位。
 */
export class VideoEditMulticamMonitor {
  private session?: VideoEditRenderSession
  private grid?: VideoEditMulticamGrid
  private contentStale = true
  private divisor?: number
  private cellBox?: { width: number; height: number }
  private clock?: ProgramClock
  private run?: PlaybackRun
  private pausedGrid = -1
  private pausedScrubbing = false
  private inFlight = 0
  private unsubmitted = 0
  private looping = false
  private again = false
  private stopped = false
  private release?: Promise<unknown>
  private shown = false
  private readonly startedAt = performance.now()
  private readonly unsubscribe: Array<() => void> = []
  private readonly resize?: ResizeObserver
  /** 屏幕缩放比例：窗口拖到另一块屏幕时 ResizeObserver 不触发，靠这个查询重选缩小倍数。 */
  private resolution?: MediaQueryList
  private readonly resolutionChanged = (): void => { this.watchResolution(); this.measure() }
  private readonly visibilityChanged = (): void => this.wake()
  constructor(private readonly instance: VideoEditInstance, private readonly sourceId: string, private readonly canvases: readonly HTMLCanvasElement[], private readonly events: VideoEditMulticamMonitorEvents, private readonly previous: Promise<unknown> = Promise.resolve()) {
    // 代理生成好或失效只发普通的视图通知，不算内容变化：视图通知时也核对代理。
    this.unsubscribe.push(subscribeVideoEditView(() => { if (!listVideoEditInstances().includes(instance)) return; this.observeClock(); this.checkProxies(); this.wake() }), subscribeVideoEditDomain(() => { this.contentStale = true; this.wake() }))
    if (typeof ResizeObserver !== 'undefined' && canvases[0]) { this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(canvases[0]) }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityChanged)
    this.watchResolution()
    this.measure()
    this.observeClock()
  }
  /** 停止出帧并释放会话；返回的承诺在 Worker 与解码会话都关闭后完成（下一个监视器等它，不重叠占用设备）。 */
  dispose(): Promise<unknown> {
    if (!this.stopped) {
      this.endRun('closed')
      this.stopped = true
      for (const stop of this.unsubscribe) stop()
      this.resize?.disconnect()
      this.resolution?.removeEventListener('change', this.resolutionChanged)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityChanged)
    }
    return this.release ??= this.session?.dispose() ?? Promise.resolve()
  }
  private watchResolution(): void {
    this.resolution?.removeEventListener('change', this.resolutionChanged)
    if (this.stopped || typeof matchMedia !== 'function') return
    this.resolution = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
    this.resolution.addEventListener('change', this.resolutionChanged)
  }
  private measure(): void {
    const box = this.canvases[0]?.getBoundingClientRect()
    if (box) this.cellBox = { width: box.width, height: box.height }
    this.wake()
  }
  /** 窗口在前台、格子有尺寸时才出帧；最小化、切到后台或面板收起时不占解码器与显卡。 */
  private visible(): boolean {
    return !(typeof document !== 'undefined' && document.hidden) && !!this.cellBox && this.cellBox.width > 0 && this.cellBox.height > 0
  }
  private checkProxies(): void {
    if (!this.grid || this.contentStale || this.stopped) return
    if (videoEditMulticamProxyKey(this.grid.cameraMedia, getVideoEditProxySources(this.instance.document.id, true)) !== this.grid.proxyKey) this.contentStale = true
  }
  private observeClock(): void {
    const instance = this.instance
    if (this.stopped || !instance.playing || instance.playbackDirection !== 1 || instance.scrubbing || !instance.activeSequenceId) { this.clock = undefined; return }
    const command = videoEditProgramCommandIdentity(instance.document.id), rate = instance.playbackRate ?? 1
    const clock = this.clock
    if (!clock || clock.command !== command || clock.rate !== rate) { this.clock = { command, rate, frame: instance.frame }; return }
    if (instance.frame <= clock.frame) return
    const estimate = performance.now() - instance.frame / (getActiveVideoEditSequence(instance).fps * rate) * 1000
    clock.zero = clock.zero === undefined || estimate < clock.zero ? estimate : clock.zero + (estimate - clock.zero) * CLOCK_FOLLOW
    clock.frame = instance.frame
  }
  wake(): void {
    if (this.stopped) return
    if (this.looping) { this.again = true; return }
    this.looping = true
    void Promise.resolve().then(async () => {
      try { do { this.again = false; await this.advance() } while (this.again && !this.stopped) }
      catch (error) {
        // 文档或缩小倍数没排上渲染队列同样是背压，稍后按最新状态重试。
        if (error instanceof VideoEditRenderBusyError) setTimeout(() => this.wake(), BUSY_RETRY_MS)
        else this.fail(error)
      }
      finally { this.looping = false }
    })
  }
  private async advance(): Promise<void> {
    await this.previous
    if (this.stopped) return
    if (!this.visible()) { this.endRun('hidden'); return }
    const instance = this.instance
    const target = instance.activeSequenceId ? videoEditProgramMulticam(instance) : undefined
    if (!target || target.source.id !== this.sourceId) return
    const parent = getActiveVideoEditSequence(instance)
    const prepared = await this.prepare(parent, target.source)
    if (!prepared || this.stopped) return
    const clock = this.clock
    if (instance.playing && instance.playbackDirection === 1 && !instance.scrubbing && !target.clip.reverse) {
      if (this.run && this.run.command !== clock?.command) this.endRun('restarted')
      // 起播后要等节目呈现出第二帧才知道它的时钟；之前网格停在暂停画面。
      if (clock?.zero !== undefined) this.play(prepared.session, prepared.grid, parent, clock, clock.zero)
      return
    }
    this.endRun('stopped')
    this.pause(prepared.session, prepared.grid, parent, target.clip)
  }
  /** 会话、网格内容与缩小倍数；网格内容只随源序列、素材与代理变化，切机位不动它。 */
  private async prepare(parent: VideoEditComposition, source: VideoEditSequence): Promise<{ session: VideoEditRenderSession; grid: VideoEditMulticamGrid } | undefined> {
    if (this.session?.terminalError) throw this.session.terminalError
    let session = this.session, grid = this.grid
    if (!session || !grid || this.contentStale) {
      this.contentStale = false
      const projectId = this.instance.document.id
      const next = videoEditMulticamGrid(parent, source, getVideoEditProxySources(projectId, true))
      if (!session || !grid) {
        const surfaces = this.canvases.map(canvas => canvas.transferControlToOffscreen())
        // 机位格子有代理就读代理（不看节目的代理开关）：格子小，代理足够清楚，播放、暂停都不必换回原片重建解码。
        session = this.session = new VideoEditRenderSession(next.composition, { previewWidth: 320, cacheBudgetBytes: 32 * 1024 ** 2, proxyProjectId: projectId, exportProxies: true, gridCells: { surfaces, columns: next.columns } })
        grid = this.grid = next
        logger.info('多机位网格画面开始准备', { event: 'video_edit.multicam.preview.start', context: { projectId, sourceId: this.sourceId, cameras: this.canvases.length, columns: next.columns, rows: next.rows, width: next.composition.width, height: next.composition.height, proxies: this.proxyCount(next) } })
      } else if (next.contentKey !== grid.contentKey || next.proxyKey !== grid.proxyKey) {
        try {
          await session.updateDocument(next.composition)
          // 只换代理时内容相同、会走参数更新而不重新选代理；同一份内容再交一次就是完整更新。
          if (next.proxyKey !== grid.proxyKey) await session.updateDocument(next.composition)
        } catch (error) { this.contentStale = true; throw error }
        if (this.stopped) return undefined
        grid = this.grid = next; this.pausedGrid = -1
        if (this.run) this.run.lastGrid = -1
      }
    }
    const aspect = grid.composition.width / grid.columns / (grid.composition.height / grid.rows)
    const box = this.cellBox ?? { width: 0, height: 0 }
    const divisor = videoEditMulticamGridDivisor(grid, Math.min(box.width, box.height * aspect) * (globalThis.devicePixelRatio || 1))
    if (divisor !== this.divisor) {
      await session.setRenderDivisor(divisor)
      this.divisor = divisor; this.pausedGrid = -1
      if (this.stopped) return undefined
    }
    return { session, grid }
  }
  private proxyCount(grid: VideoEditMulticamGrid): number { return (JSON.parse(grid.proxyKey) as Array<string | null>).filter(Boolean).length }
  /** 播放头 `frame` 处这个源序列的多机位片段（与节目选同一个：同轨优先，再取最上层）。 */
  private clipAt(parent: VideoEditComposition, frame: number, track: number): VideoEditClip | undefined {
    const candidates = activeVideoEditClips(parent, frame).filter(clip => videoEditMulticamSource(this.instance.document, clip)?.id === this.sourceId)
    return candidates.find(clip => clip.track === track) ?? candidates.at(-1)
  }
  private play(session: VideoEditRenderSession, layout: VideoEditMulticamGrid, parent: VideoEditComposition, clock: ProgramClock, zero: number): void {
    if (this.inFlight >= FRAMES_IN_FLIGHT || this.unsubmitted >= UNSUBMITTED_FRAMES) return
    // 播放过后格子上是播放帧：停下时按精确方式重画暂停帧。
    if (!this.run) this.pausedGrid = -1
    const run = this.run ??= { command: clock.command, lastFrame: -1, lastGrid: -1 }
    const rate = parent.fps * clock.rate, duration = videoEditDuration(parent)
    const due = Math.floor((performance.now() - zero) * rate / 1000 + 1e-6)
    const track = videoEditProgramMulticam(this.instance)?.clip.track ?? 0
    // 跟不上时钟时直接跳到还来得及按时呈现的帧（丢帧），不让网格越拖越晚。
    let frame = videoEditPlaybackTarget(run.lastFrame < 0 ? due : run.lastFrame + 1, due, 0, duration)
    for (const end = Math.min(duration, frame + Math.ceil(parent.fps)); frame < end; frame++) {
      const clip = this.clipAt(parent, frame, track)
      // 播放头离开多机位片段：网格停在最后一帧。
      if (!clip) return
      const grid = videoEditNestedFrame(parent, clip, layout.composition, frame)
      // 慢放、定格时相邻几帧是同一幅源画面，只画一次。
      if (grid <= run.lastGrid) continue
      // 只提前排几帧：再往后的等节目下一次呈现再排。
      if (frame > due + FRAMES_IN_FLIGHT) return
      run.lastFrame = frame; run.lastGrid = grid
      this.request(session, grid, true, false, performance.timeOrigin + zero + frame / rate * 1000, run)
      this.again = true
      return
    }
  }
  private pause(session: VideoEditRenderSession, layout: VideoEditMulticamGrid, parent: VideoEditComposition, clip: VideoEditClip): void {
    const grid = videoEditNestedFrame(parent, clip, layout.composition, this.instance.frame)
    const scrubbing = !!this.instance.scrubbing
    // 松手后按精确方式重画拖动中最后一帧。
    if (grid === this.pausedGrid && (scrubbing || !this.pausedScrubbing)) return
    if (this.inFlight >= PAUSED_IN_FLIGHT) return
    this.pausedGrid = grid; this.pausedScrubbing = scrubbing
    this.request(session, grid, false, scrubbing)
  }
  private request(session: VideoEditRenderSession, grid: number, sequential: boolean, scrubbing: boolean, deadline?: number, run?: PlaybackRun): void {
    this.inFlight++
    if (run) this.unsubmitted++
    let submitted = false
    const requestedAt = performance.now()
    void session.present(grid, sequential, scrubbing, deadline, run ? () => { submitted = true; this.unsubmitted--; this.wake() } : undefined)
      .then(result => this.presented(result, grid, requestedAt, run), error => this.requestFailed(error, run))
      .finally(() => { this.inFlight--; if (run && !submitted) this.unsubmitted--; this.wake() })
  }
  private presented(result: RenderResponse, grid: number, requestedAt: number, run: PlaybackRun | undefined): void {
    if (this.stopped || result.skipped || result.presented !== true) return
    const now = performance.now()
    if (run && run === this.run) {
      if (run.collector) run.collector.add(grid, result, now - requestedAt)
      else run.collector = new VideoEditPlaybackCollector(grid, now)
      run.shownAt = now
    }
    if (this.shown) return
    this.shown = true
    logger.info('多机位网格画面已显示', { event: 'video_edit.multicam.preview.first_frame', context: { projectId: this.instance.document.id, sourceId: this.sourceId, cameras: this.canvases.length, durationMs: Math.round(now - this.startedAt), divisor: this.divisor } })
    this.events.presented()
  }
  private requestFailed(error: unknown, run: PlaybackRun | undefined): void {
    if (this.stopped) return
    if (!(error instanceof VideoEditRenderBusyError)) { this.fail(error); return }
    // 渲染队列排满是背压：这一帧没排上，稍后按最新状态重新请求。
    if (!run) this.pausedGrid = -1
    setTimeout(() => this.wake(), BUSY_RETRY_MS)
  }
  private fail(error: unknown): void {
    if (this.stopped) return
    void this.dispose()
    this.events.failed(error)
  }
  /** 结束这次正向播放：撤下还没上屏的播放帧，按网格帧写一条出帧统计。 */
  private endRun(reason: 'stopped' | 'restarted' | 'hidden' | 'closed'): void {
    const run = this.run
    if (!run) return
    this.run = undefined
    if (reason !== 'closed' && this.session && !this.session.terminated) this.session.stopPlayback(Math.max(0, run.lastGrid))
    const summary = run.collector?.summary(run.shownAt ?? performance.now())
    if (!summary || summary.expectedFrames < 2 || !this.grid) return
    logger.info('多机位播放统计', { event: 'video_edit.multicam.playback.stats', context: {
      projectId: this.instance.document.id, sourceId: this.sourceId, reason, cameras: this.canvases.length, fps: this.grid.composition.fps,
      actualFps: summary.durationMs > 0 ? Math.round((summary.presentedFrames - 1) / summary.durationMs * 1e5) / 100 : 0,
      divisor: this.divisor, width: this.grid.composition.width, height: this.grid.composition.height, proxies: this.proxyCount(this.grid), ...summary,
    } })
  }
}
