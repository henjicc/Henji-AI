import type { VideoEditMedia } from '@/core/videoEdit/document'
import { createLogger } from '@/core/logging'
import type { VideoEditClipFrames, VideoEditDecodedPicture, VideoEditFrameBackend } from './videoEditFrameSource'
import type { VideoEditGpuFrame } from './videoEditGpuFrame'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'

/**
 * 跳转先出的画面（节目监视器）：预渲染文件（整帧合成结果，每秒一个关键帧）的关键帧，以四分之一尺寸常驻显存。
 *
 * 远距离跳转与很快的拖动先画目标之前最近的一幅（不超过一秒），不必打开解码会话、读视频、跑代码素材，也不受长 GOP
 * 原片影响；随后照常补实时合成的精确帧。4K 序列一幅约 0.78MB，预算内按离播放头的远近保留。
 *
 * 只在空闲时补：每一步只打开一个文件或解一个关键帧（各约 15–25ms），节目一有画面请求就停下，不与前台取帧争解码器。
 * 每个窗口按内容指纹认人，内容一改，窗口从预渲染清单里消失，它的画面随之丢弃，不会画出旧内容。
 */
export interface VideoEditJumpPreviewWindow { key: string; startFrame: number; endFrame: number; fps: number; media: VideoEditMedia }

/** 常驻画面的显存预算（字节）。 */
export const VIDEO_EDIT_JUMP_PREVIEW_BYTES = 384 * 1024 ** 2
/** 常驻画面按序列尺寸缩小的倍数。 */
export const VIDEO_EDIT_JUMP_PREVIEW_DIVISOR = 4
/** 预渲染文件的关键帧间隔（秒，见 renderBitrate 的 keyframeInterval）。 */
const KEY_SECONDS = 1
/** 读不到（预算不够、文件已被清理）后隔这么久再试。 */
const RETRY_MS = 2000
const logger = createLogger('features.videoEdit.jumpPreview')

/** One pre-rendered file (`key`, its content fingerprint); a repeated section shows the same file at several `spans`. */
interface Entry { key: string; media: VideoEditMedia; seconds: number; fps: number; spans: Array<{ startFrame: number; endFrame: number }>; pictures: Array<{ time: number; picture: VideoEditGpuFrame }>; next: number; done: boolean; active: boolean }

export class VideoEditJumpPreview {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private reader?: { key: string; demux: string; frames: VideoEditClipFrames }
  /** Reader of `exactPicture` (one file at a time), and the read under way on it. */
  private exactReader?: { key: string; demux: string; frames: VideoEditClipFrames }
  private exactTail: Promise<unknown> = Promise.resolve()
  /** The newest `exactPicture` request; a newer jump abandons it. */
  private exactRequest?: AbortController
  private blockedUntil = 0
  private disposed = false
  /** Draws still reading a picture on the GPU (`lease`); pictures dropped meanwhile close once none is left. */
  private leases = 0
  private readonly retired: VideoEditGpuFrame[] = []
  /** 这一轮补帧：从第一步做事起，到再无可补或预算用满为止（中途被节目打断不算结束）；workMs 是各步本身的耗时。 */
  private fillRun?: { startedAt: number; steps: number; workMs: number }
  /** 本实例补满过一次没有：第一次即冷启动。 */
  private filledOnce = false

  constructor(private readonly frames: VideoEditFrameBackend, private readonly snapshot: (picture: VideoEditDecodedPicture) => Promise<VideoEditGpuFrame>, private readonly budgetBytes = VIDEO_EDIT_JUMP_PREVIEW_BYTES) {}

  get pictureBytes(): number { return this.bytes }
  get pictureCount(): number { return [...this.entries.values()].reduce((sum, entry) => sum + entry.pictures.length, 0) }

  /**
   * 当前有效的预渲染窗口。空清单（内容刚改、新清单还没算好）只暂停使用，不丢已解好的画面；之后的清单里不再有的窗口才丢弃。
   */
  setWindows(windows: readonly VideoEditJumpPreviewWindow[]): void {
    if (!windows.length) { for (const entry of this.entries.values()) entry.active = false; return }
    const keys = new Set(windows.map(window => window.key))
    for (const key of [...this.entries.keys()]) if (!keys.has(key)) this.drop(key)
    for (const entry of this.entries.values()) { entry.active = true; entry.spans = [] }
    for (const window of windows) {
      const span = { startFrame: window.startFrame, endFrame: window.endFrame }
      const entry = this.entries.get(window.key)
      if (entry) entry.spans.push(span)
      else this.entries.set(window.key, { key: window.key, media: window.media, seconds: (window.endFrame - window.startFrame) / window.fps, fps: window.fps, spans: [span], pictures: [], next: 0, done: false, active: true })
    }
  }

  /** 预渲染窗口 `key`（从 `startFrame` 起盖住 `frame`）里不晚于 `frame`、相差不超过一个关键帧间隔的常驻画面。 */
  pick(key: string, startFrame: number, frame: number): VideoEditGpuFrame | undefined {
    const entry = this.entries.get(key)
    if (!entry?.active) return undefined
    const time = (frame - startFrame) / entry.fps
    let best: Entry['pictures'][number] | undefined
    for (const item of entry.pictures) if (item.time <= time + 1e-6 && (!best || item.time > best.time)) best = item
    return best && time - best.time <= KEY_SECONDS + 0.5 / entry.fps ? best.picture : undefined
  }

  /** Keeps dropped pictures alive until the returned release is called (after the drawing frame's GPU completion). */
  lease(): () => void {
    this.leases++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--this.leases === 0) for (const picture of this.retired.splice(0)) picture.close()
    }
  }

  private retire(pictures: ReadonlyArray<{ picture: VideoEditGpuFrame }>): void {
    for (const { picture } of pictures) { this.bytes -= picture.allocationSize(); if (this.leases) this.retired.push(picture); else picture.close() }
  }

  /**
   * 空闲时的一步：离 `around` 最近、还没解完的窗口打开它的文件，或解下一个关键帧。返回是否做了事（没事可做时调用方停下）。
   * `current` 返回假时（节目有了新请求）不再开始下一步。
   */
  async fillStep(around: number, current: () => boolean): Promise<boolean> {
    if (this.disposed || performance.now() < this.blockedUntil || !current()) return false
    // 节目停下了：精确画面的读取器把解码会话还回去。
    this.closeExact()
    const distance = (entry: Entry): number => Math.min(...entry.spans.map(span => around < span.startFrame ? span.startFrame - around : around >= span.endFrame ? around - span.endFrame + 1 : 0))
    const pending = [...this.entries.values()].filter(entry => entry.active && !entry.done).sort((a, b) => distance(a) - distance(b))
    const target = pending[0]
    if (!target) { this.closeReader(); this.finishFill('complete', around, distance); return false }
    if (this.bytes >= this.budgetBytes && !this.evictFarther(distance, distance(target))) { this.closeReader(); this.finishFill('budget', around, distance); return false }
    const started = performance.now()
    this.fillRun ??= { startedAt: started, steps: 0, workMs: 0 }
    this.fillRun.steps++
    try {
      if (this.reader?.key !== target.key) {
        this.closeReader()
        const demux = this.frames.open(target.media)
        const source = await demux.ready.catch(error => { this.frames.release(demux.key); throw error })
        const frames = source.clipFrames({ exclusive: true })
        if (!frames) { this.frames.release(demux.key); target.done = true; return true }
        if (this.disposed) { frames.close?.(); this.frames.release(demux.key); return false }
        this.reader = { key: target.key, demux: demux.key, frames }
        recordVideoEditPreparation('jumpPreviewOpen', performance.now() - started)
        return true
      }
      const time = target.next * KEY_SECONDS
      if (time >= target.seconds - 0.5 / target.fps) { target.done = true; this.closeReader(); return true }
      // 只解关键帧：每次都落在新的 GOP 上，解码器只解这一幅。
      const decoded = await this.reader.frames.frameAt(time + 1e-4, { keyFrame: true, speculative: true })
      target.next++
      if (!decoded) return true
      let picture: VideoEditGpuFrame
      try { picture = await this.snapshot(decoded) } finally { decoded.close() }
      if (this.disposed || this.entries.get(target.key) !== target) { picture.close(); return false }
      target.pictures.push({ time: decoded.timestamp, picture }); this.bytes += picture.allocationSize()
      recordVideoEditPreparation('jumpPreviewKey', performance.now() - started)
      return true
    } catch {
      // 预算不够、文件已被清理或解码失败：这一轮不再补，稍后从这里重试（读不到的窗口跳过这一幅）。
      this.closeReader(); target.next++; this.blockedUntil = performance.now() + RETRY_MS
      return false
    } finally {
      if (this.fillRun) this.fillRun.workMs += performance.now() - started
    }
  }

  /**
   * 补满一轮时记一条：冷启动要多久才补够，是决定要不要先补播放头附近的依据。
   * coveredFrames：离播放头多少帧之内的窗口全部补好（全片补好时为最远一帧的距离）。
   */
  private finishFill(reason: 'complete' | 'budget', around: number, distance: (entry: Entry) => number): void {
    const run = this.fillRun
    if (!run) return
    this.fillRun = undefined
    const active = [...this.entries.values()].filter(entry => entry.active)
    const unfilled = active.filter(entry => !entry.done || !entry.pictures.length).map(distance)
    const farthest = Math.max(0, ...active.flatMap(entry => entry.spans.map(span => Math.max(Math.abs(span.startFrame - around), Math.abs(span.endFrame - 1 - around)))))
    const coveredFrames = unfilled.length ? Math.max(0, Math.min(...unfilled) - 1) : farthest
    logger.info('常驻关键帧已补满', { event: 'video_edit.jump_preview.filled', context: {
      reason, cold: !this.filledOnce, elapsedMs: Math.round(performance.now() - run.startedAt), workMs: Math.round(run.workMs), steps: run.steps,
      pictures: this.pictureCount, megabytes: Math.round(this.bytes / 1024 ** 2), windows: active.length, filledWindows: active.length - unfilled.length, aroundFrame: around, coveredFrames,
    } })
    this.filledOnce = true
  }

  /** 为更近的窗口腾出预算：丢掉比 `limit` 更远的窗口里最远的一个。 */
  private evictFarther(distance: (entry: Entry) => number, limit: number): boolean {
    const farthest = [...this.entries.values()].filter(entry => entry.pictures.length && distance(entry) > limit).sort((a, b) => distance(b) - distance(a))[0]
    if (!farthest) return false
    this.retire(farthest.pictures)
    farthest.pictures = []; farthest.next = 0; farthest.done = false
    return true
  }

  /**
   * 预渲染文件 `media`（窗口 `key`）在 `seconds` 处的精确画面（整帧合成结果），用一个自己的读取器读（同一文件连续读续解）；
   * 读不到时为 undefined。暂停画面的实时合成要从长 GOP 原片的关键帧解起（4K 录屏可达一秒），这一幅先替它站在屏幕上。
   * 前一次读取完成后才开始（读取器同时只读一幅），轮到时 `wanted` 已为假（又有了新请求、实时画面已好）就不读；`snapshot`
   * 把它复制进自有显存，调用方用完关闭。新的跳转取代上一次：上一幅还没读完就放弃（解码停在已解到的位置，这一幅
   * 从那里接着解），它得到 undefined。
   */
  exactPicture(key: string, media: VideoEditMedia, seconds: number, snapshot: (picture: VideoEditDecodedPicture) => Promise<VideoEditGpuFrame>, wanted: () => boolean = () => true): Promise<VideoEditGpuFrame | undefined> {
    this.exactRequest?.abort()
    const request = new AbortController()
    this.exactRequest = request
    const read = async (): Promise<VideoEditGpuFrame | undefined> => {
      if (this.disposed || request.signal.aborted || !this.entries.get(key)?.active || !wanted()) return undefined
      if (this.exactReader?.key !== key) {
        this.closeExact()
        const demux = this.frames.open(media)
        const source = await demux.ready.catch(error => { this.frames.release(demux.key); throw error })
        const frames = source.clipFrames({ exclusive: true })
        if (!frames) { this.frames.release(demux.key); return undefined }
        if (this.disposed) { frames.close?.(); this.frames.release(demux.key); return undefined }
        this.exactReader = { key, demux: demux.key, frames }
      }
      const decoded = await this.exactReader.frames.frameAt(seconds, { speculative: true, signal: request.signal })
      if (!decoded) return undefined
      try { return this.disposed || request.signal.aborted ? undefined : await snapshot(decoded) } finally { decoded.close() }
    }
    // An abandoned read keeps its reader (the next read continues its decoder); a failed one gives it back.
    const result = this.exactTail.then(read, read).catch(() => { if (!request.signal.aborted) this.closeExact(); return undefined })
      .finally(() => { if (this.exactRequest === request) this.exactRequest = undefined })
    this.exactTail = result
    return result
  }

  private closeExact(): void {
    const reader = this.exactReader
    if (!reader) return
    this.exactReader = undefined
    reader.frames.close?.(); this.frames.release(reader.demux)
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.retire(entry.pictures)
    this.entries.delete(key)
    if (this.reader?.key === key) this.closeReader()
    if (this.exactReader?.key === key) this.closeExact()
  }

  private closeReader(): void {
    const reader = this.reader
    if (!reader) return
    this.reader = undefined
    reader.frames.close?.(); this.frames.release(reader.demux)
  }

  /** Called after the last draw with these pictures was submitted; closing waits for nothing else. */
  dispose(): void {
    this.disposed = true
    this.closeReader(); this.closeExact()
    for (const key of [...this.entries.keys()]) this.drop(key)
    this.leases = 0
    for (const picture of this.retired.splice(0)) picture.close()
  }
}
