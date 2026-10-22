import { activeVideoEditClips, clipSourceSeconds, videoEditClipMedia, videoEditNestedComposition, videoEditVisibleTracks, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditNestedFrame } from '@/core/videoEdit/nestedSequences'
import { VIDEO_EDIT_MAX_SEQUENCE_DEPTH } from '@/core/videoEdit/sequenceGraph'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { codeMediaInputComposition } from '@/core/videoEdit/codeMediaInput'
import { videoEditHandleFrame, videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { videoEditPictureSeconds } from '@/core/videoEdit/time'
import type { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import type { VideoEditRenderCacheWindow } from './videoEditRenderer'
import { videoEditNativeFailureKind } from './videoEditNativeFailure'

// 原片打开约 200ms，加约 1 秒 GOP 定位及调度余量；3 秒覆盖切点，避免预打开整条时间线。
export const VIDEO_EDIT_DECODE_LOOKAHEAD_SECONDS = 3
export const VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS = 2
export interface VideoEditDecodeTarget { media: VideoEditMedia; time: number; purpose: 'playback' | 'seek'; distance: number }
const keyOf = (target: VideoEditDecodeTarget): string => `${target.media.path}\0${target.media.sourceRevision ?? ''}\0${target.purpose}`

/** 复用正式时间映射，逐节目帧覆盖短片段、变速嵌套、过渡余量及代码视频参数。 */
export function videoEditDecodeTargets(document: VideoEditComposition, frame: number, playing: boolean, windows: readonly VideoEditRenderCacheWindow[] = []): VideoEditDecodeTarget[] {
  const targets = new Map<string, VideoEditDecodeTarget>()
  const add = (media: VideoEditMedia, time: number, purpose: VideoEditDecodeTarget['purpose'], distance: number): void => {
    const target = { media, time, purpose, distance }, key = keyOf(target)
    if (!targets.has(key) || targets.get(key)!.distance > distance) targets.set(key, target)
  }
  const visit = (doc: VideoEditComposition, at: number, distance: number, sequential: boolean, depth: number): void => {
    if (depth >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) return
    const visible = videoEditVisibleTracks(doc)
    const clips = new Map(activeVideoEditClips(doc, at).filter(clip => clip.kind !== 'audio' && visible.has(clip.track)).map(clip => [clip.id, clip]))
    for (const window of videoEditTransitionsAt(doc, at)) if (visible.has(window.left.track)) for (const clip of [window.left, window.right]) clips.set(clip.id, clip)
    for (const clip of clips.values()) {
      if (clip.kind === 'sequence') {
        const child = videoEditNestedComposition(doc, clip)
        if (child) visit(child, videoEditNestedFrame(doc, clip, child, at), distance, sequential && !clip.reverse, depth + 1)
      } else if (clip.kind === 'video') {
        const media = videoEditClipMedia(doc, clip)
        if (media?.kind === 'video') add(media, videoEditPictureSeconds(clipSourceSeconds(clip, videoEditHandleFrame(clip, at, doc.fps, media.durationSeconds), doc.fps)), sequential && !clip.reverse ? 'playback' : 'seek', distance)
      }
      for (const code of [clip.code, ...activeVideoEditEffects(clip).map(effect => effect.code)]) {
        for (const reference of Object.values(code?.parameters ?? {})) {
          if (!isCodeImageReference(reference) || reference.kind === 'image') continue
          // 非法参数交由正式渲染报告，推测准备不影响当前帧。
          try { const input = codeMediaInputComposition(doc, clip, reference, at); visit(input.document, input.frame, distance, false, depth + 1) } catch { /* 正式读取负责报错。 */ }
        }
      }
    }
  }
  const before = playing ? 0 : Math.ceil(document.fps * VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS)
  const after = Math.ceil(document.fps * (playing ? VIDEO_EDIT_DECODE_LOOKAHEAD_SECONDS : VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS))
  // 先当前再向前后展开：同文件保留距离最近的入点，播放时自然取即将进入的第一帧。
  for (let offset = 0; offset <= Math.max(before, after); offset++) {
    for (const delta of offset === 0 ? [0] : [offset, -offset]) {
      if (delta < -before || delta > after || frame + delta < 0) continue
      const at = frame + delta, distance = Math.abs(delta) / document.fps
      const cached = playing ? windows.find(window => at >= window.startFrame && at < window.endFrame) : undefined
      if (cached) {
        add({ id: `render-cache:${cached.key}`, name: '预渲染', kind: 'video', path: cached.url, width: cached.width, height: cached.height, hasAudio: false, durationSeconds: (cached.endFrame - cached.startFrame) / cached.fps }, (at - cached.startFrame) / document.fps, 'playback', distance)
      } else visit(document, at, distance, playing, 0)
    }
  }
  return [...targets.values()].sort((a, b) => a.distance - b.distance)
}

/** 单并发推测队列；前台消息先打断，当前帧完成后才安排下一份。 */
export class VideoEditDecodeLookahead {
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private controller?: AbortController
  private targets: VideoEditDecodeTarget[] = []
  private readonly attempted = new Set<string>()
  private last?: { frame: number; playing: boolean; document: VideoEditComposition }
  private lastScan = -Infinity

  constructor(private readonly backend: VideoEditNativeFrames, private readonly mapMedia: (media: VideoEditMedia) => VideoEditMedia = media => media) {}

  cancel(): void {
    this.epoch++; clearTimeout(this.timer); this.controller?.abort(); this.backend.cancelSpeculative()
    this.attempted.clear(); this.targets = []; this.last = undefined; this.lastScan = -Infinity
  }

  beforeFrame(document: VideoEditComposition, frame: number, playing: boolean): void {
    const last = this.last
    if (!playing || !last || !last.playing || last.document !== document || frame < last.frame - 3 || frame - last.frame > Math.ceil(document.fps)) this.cancel()
    this.last = { frame, playing, document }
  }

  update(document: VideoEditComposition, frame: number, playing: boolean, windows: readonly VideoEditRenderCacheWindow[]): void {
    if (!this.last || this.last.document !== document || this.last.frame !== frame || this.last.playing !== playing) return
    if (playing && performance.now() - this.lastScan < 250) return
    this.lastScan = performance.now()
    const epoch = this.epoch
    clearTimeout(this.timer)
    // 扫描放在当前帧回执之后；未来片段损坏不能使当前帧失败。
    this.timer = setTimeout(() => {
      if (epoch !== this.epoch) return
      const started = performance.now()
      try {
        this.targets = videoEditDecodeTargets(document, frame, playing, windows).map(target => ({ ...target, media: this.mapMedia(target.media) })).filter(target => this.backend.reads(target.media))
        const wanted = new Set(this.targets.map(keyOf))
        for (const key of this.attempted) if (!wanted.has(key)) this.attempted.delete(key)
        void this.drain()
      } catch (error) { this.backend.log('debug', '前瞻来源扫描失败', 'video_edit.decode.preopen.failed', { reason: String(error), durationMs: performance.now() - started }) }
    }, playing ? 0 : 120)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    const epoch = this.epoch
    try {
      const distances = new Map<string, number>()
      for (const target of this.targets) distances.set(target.media.path, Math.min(distances.get(target.media.path) ?? Infinity, target.distance))
      await this.backend.maintain(distances)
      while (epoch === this.epoch) {
        const target = this.targets.find(target => !this.attempted.has(keyOf(target)) && this.backend.needsPreopen(target.media, target.purpose))
        if (!target) break
        const key = keyOf(target), started = performance.now()
        this.attempted.add(key)
        const controller = new AbortController(); this.controller = controller
        if (!await this.backend.canPreopen()) {
          this.backend.log('debug', '预算不足，放弃推测预打开', 'video_edit.decode.preopen.skipped', { mediaId: target.media.id, reason: 'budget', durationMs: performance.now() - started })
          continue
        }
        if (epoch !== this.epoch || controller.signal.aborted) break
        this.backend.log('debug', '提前打开并定位解码会话', 'video_edit.decode.preopen.start', { mediaId: target.media.id, purpose: target.purpose, sourceSeconds: target.time, distanceSeconds: target.distance, durationMs: 0 })
        const reservation = this.backend.preopen(target.media, { ...target, signal: controller.signal })
        try {
          await reservation.ready
          this.backend.log('debug', '解码会话已提前定位', 'video_edit.decode.preopen.completed', { mediaId: target.media.id, purpose: target.purpose, durationMs: performance.now() - started })
        } catch (error) {
          const cancelled = error instanceof Error && error.name === 'AbortError'
          const budget = videoEditNativeFailureKind(error) === 'budget'
          this.backend.log('debug', '推测预打开未完成', budget ? 'video_edit.decode.preopen.skipped' : 'video_edit.decode.preopen.failed', { mediaId: target.media.id, reason: budget ? 'budget' : cancelled ? 'cancelled' : String(error), durationMs: performance.now() - started })
          if (cancelled) { this.attempted.delete(key); break }
        } finally { reservation.release() }
      }
    } catch (error) {
      this.backend.log('debug', '前瞻队列未完成', 'video_edit.decode.preopen.failed', { reason: String(error), durationMs: 0 })
    } finally {
      this.running = false; this.controller = undefined
      if (epoch !== this.epoch && this.targets.length) this.timer = setTimeout(() => { void this.drain() }, 120)
    }
  }
}
