import { activeVideoEditClips, clipSourceSeconds, videoEditClipMedia, videoEditNestedComposition, videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditNestedPictureFrame, videoEditNestedPictureKey } from '@/core/videoEdit/nestedSequences'
import { VIDEO_EDIT_MAX_SEQUENCE_DEPTH } from '@/core/videoEdit/sequenceGraph'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { codeMediaInputComposition } from '@/core/videoEdit/codeMediaInput'
import { videoEditHandleFrame, videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { videoEditPictureSeconds } from '@/core/videoEdit/time'
import type { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import type { VideoEditRenderCacheWindow } from './videoEditRenderer'
import { videoEditNativeFailureKind } from './videoEditNativeFailure'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'

// 原片打开约 200ms，加约 1 秒 GOP 定位及调度余量；3 秒覆盖切点，避免预打开整条时间线。
export const VIDEO_EDIT_DECODE_LOOKAHEAD_SECONDS = 3
export const VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS = 2
/**
 * Stills (code video inputs fixed at one time) are decoded once and kept for the session, so while paused or idle they
 * are looked for this far ahead of the playhead (and `VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS` behind it). Playback then
 * never seeks far for one on the critical path.
 */
export const VIDEO_EDIT_STILL_LOOKAHEAD_SECONDS = 20
export interface VideoEditLookaheadScope { document: VideoEditComposition; key: string; input?: ReturnType<typeof codeMediaInputComposition>; parent?: VideoEditComposition }
export interface VideoEditDecodeTarget { media: VideoEditMedia; time: number; purpose: 'playback' | 'seek'; distance: number; clipId?: string }
/** `still`: a code video input fixed at one time; `input` is its input composition (decoded into the renderer's still store). */
export interface VideoEditContentTarget { kind: 'image' | 'code' | 'still'; key: string; scopes: VideoEditLookaheadScope[]; document: VideoEditComposition; clip: VideoEditClip; frame: number; media?: VideoEditMedia; distance: number; input?: ReturnType<typeof codeMediaInputComposition> }
export interface VideoEditLookaheadTargets { video: VideoEditDecodeTarget[]; content: VideoEditContentTarget[] }
const keyOf = (target: VideoEditDecodeTarget): string => `${target.media.path}\0${target.media.sourceRevision ?? ''}\0${target.purpose}`

/** 与节目共用嵌套映射、转场余量和输入合成；逐帧扫描以免漏掉变速后的短镜头。 */
export function videoEditLookaheadTargets(document: VideoEditComposition, frame: number, playing: boolean, windows: readonly VideoEditRenderCacheWindow[] = []): VideoEditLookaheadTargets {
  const targets = new Map<string, VideoEditDecodeTarget>(), content = new Map<string, VideoEditContentTarget>()
  const add = (media: VideoEditMedia, time: number, purpose: VideoEditDecodeTarget['purpose'], distance: number, clipId?: string): void => {
    const target = { media, time, purpose, distance, clipId }, key = keyOf(target)
    if (!targets.has(key)) targets.set(key, target)
  }
  const visit = (doc: VideoEditComposition, at: number, distance: number, sequential: boolean, scopes: VideoEditLookaheadScope[]): void => {
    if (scopes.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) return
    const visible = videoEditVisibleTracks(doc)
    const clips = new Map(activeVideoEditClips(doc, at).filter(clip => clip.kind !== 'audio' && visible.has(clip.track)).map(clip => [clip.id, clip]))
    for (const window of videoEditTransitionsAt(doc, at)) if (visible.has(window.left.track)) for (const clip of [window.left, window.right]) clips.set(clip.id, clip)
    const scopeKey = JSON.stringify(scopes.map(scope => scope.key))
    for (const clip of clips.values()) {
      if (clip.kind === 'sequence') {
        const child = videoEditNestedComposition(doc, clip)
        if (child) visit(child, videoEditNestedPictureFrame(doc, clip, child, at), distance, sequential && !clip.reverse, [...scopes, { document: child, key: videoEditNestedPictureKey(child, clip) }])
      } else if (clip.kind === 'video') {
        const media = videoEditClipMedia(doc, clip)
        if (media?.kind === 'video') add(media, videoEditPictureSeconds(clipSourceSeconds(clip, videoEditHandleFrame(clip, at, doc.fps, media.durationSeconds), doc.fps)), sequential && !clip.reverse ? 'playback' : 'seek', distance, clip.id)
      }
      const codes = [clip.code, ...activeVideoEditEffects(clip).map(effect => effect.code)].filter(code => !!code)
      const ids = new Set([...(clip.kind === 'image' ? [videoEditClipMedia(doc, clip)?.id ?? ''] : []), ...codes.flatMap(code => [...codeMaterialImageIds(code)])])
      for (const id of ids) {
        const media = doc.media.find(media => media.id === id && media.kind === 'image')
        const key = `${scopeKey}:image:${id}:${media?.path}:${media?.sourceRevision ?? ''}`
        if (media && !content.has(key)) content.set(key, { kind: 'image', key, scopes, document: doc, clip, frame: at, media, distance })
      }
      if (codes.length) {
        const key = `${scopeKey}:code:${clip.id}:${codes.map(code => `${code.definitionId}:${code.versionId}`).join(',')}`
        if (!content.has(key)) content.set(key, { kind: 'code', key, scopes, document: doc, clip, frame: at, distance })
      }
      // 下层序列输入使用无 previewWidth 的正式输入渲染器，读取共享 seek 会话。视频输入每个引用独占自己的解码会话，
      // 由渲染器在片段开始前自己打开并解到入点（videoEditRenderer 的 prewarmCodeInputs），这里不再为它预开共享会话。
      for (const code of codes) for (const reference of Object.values(code.parameters)) {
        if (!isCodeImageReference(reference) || reference.kind !== 'sequence') continue
        try {
          const input = codeMediaInputComposition(doc, clip, reference, at)
          visit(input.document, input.frame, distance, false, [...scopes, { document: input.document, key: input.sessionKey, input, parent: doc }])
        } catch { /* 非法引用由正式渲染报告。 */ }
      }
    }
  }
  const before = playing ? 0 : Math.ceil(document.fps * VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS)
  const after = Math.ceil(document.fps * (playing ? VIDEO_EDIT_DECODE_LOOKAHEAD_SECONDS : VIDEO_EDIT_DECODE_NEIGHBOUR_SECONDS))
  for (let offset = 0; offset <= Math.max(before, after); offset++) {
    for (const delta of offset === 0 ? [0] : [offset, -offset]) {
      if (delta < -before || delta > after || frame + delta < 0) continue
      const at = frame + delta, distance = Math.abs(delta) / document.fps
      const cached = playing ? windows.find(window => at >= window.startFrame && at < window.endFrame) : undefined
      if (cached) add({ id: `render-cache:${cached.key}`, name: '预渲染', kind: 'video', path: cached.url, width: cached.width, height: cached.height, hasAudio: false, durationSeconds: (cached.endFrame - cached.startFrame) / cached.fps }, (at - cached.startFrame) / document.fps, 'playback', distance)
      else visit(document, at, distance, playing, [])
    }
  }
  // Stills: every fixed-time video input of a clip in the wider window, once per picture (nested sequences included).
  const stills = (doc: VideoEditComposition, from: number, to: number, distanceAt: (at: number) => number, depth: number): void => {
    if (depth >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH || to <= from) return
    const visible = videoEditVisibleTracks(doc)
    for (const clip of doc.clips) {
      const start = Math.max(from, clip.start), end = Math.min(to, clip.start + clip.duration)
      if (end <= start || !visible.has(clip.track)) continue
      if (clip.kind === 'sequence') {
        const child = videoEditNestedComposition(doc, clip)
        if (!child) continue
        const ends = [videoEditNestedPictureFrame(doc, clip, child, start), videoEditNestedPictureFrame(doc, clip, child, end - 1)]
        stills(child, Math.floor(Math.min(...ends)), Math.ceil(Math.max(...ends)) + 1, () => distanceAt(start), depth + 1)
        continue
      }
      if (!clip.code) continue
      for (const reference of Object.values(clip.code.parameters)) {
        if (!isCodeImageReference(reference) || reference.kind !== 'video' || reference.time === undefined) continue
        try {
          const input = codeMediaInputComposition(doc, clip, reference, start)
          const media = input.document.media.find(item => item.id === reference.mediaId)
          const key = `still:${media?.path}:${media?.sourceRevision ?? ''}:${reference.time}`
          const distance = distanceAt(start)
          const existing = content.get(key)
          if (!existing || existing.distance > distance) content.set(key, { kind: 'still', key, scopes: [], document: doc, clip, frame: start, distance, input })
        } catch { /* 非法引用由进入片段时的正式渲染报告。 */ }
      }
    }
  }
  // While playing, the renderer opens stills within its own horizon ahead (stepping between frames); paused or idle, the
  // lookahead decodes the ones further around the playhead so playing reaches them already kept.
  if (!playing) stills(document, Math.max(0, frame - before), frame + Math.ceil(document.fps * VIDEO_EDIT_STILL_LOOKAHEAD_SECONDS) + 1, at => Math.max(0, at - frame) / document.fps, 0)
  return { video: [...targets.values()], content: [...content.values()] }
}
export function videoEditDecodeTargets(document: VideoEditComposition, frame: number, playing: boolean, windows: readonly VideoEditRenderCacheWindow[] = []): VideoEditDecodeTarget[] {
  return videoEditLookaheadTargets(document, frame, playing, windows).video
}

/** 单并发推测队列；前台消息先打断，当前帧完成后才安排下一份。 */
export class VideoEditDecodeLookahead {
  private epoch = 0
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private controller?: AbortController
  private targets: VideoEditDecodeTarget[] = []
  private content: VideoEditContentTarget[] = []
  private readonly prepared = new Set<string>()
  private readonly attempted = new Set<string>()
  private readonly retryAfter = new Map<string, number>()
  private last?: { frame: number; playing: boolean; document: VideoEditComposition }
  private lastScan = -Infinity
  private maintainedAt = -Infinity

  constructor(private readonly backend: VideoEditNativeFrames | undefined, private readonly mapMedia: (media: VideoEditMedia) => VideoEditMedia = media => media,
    private readonly host?: { idle(): boolean; prepare(target: VideoEditContentTarget, signal: AbortSignal): Promise<boolean>; retain(targets: readonly VideoEditContentTarget[]): void }) {}

  clipIdsForMedia(mediaId: string): string[] { return this.targets.filter(target => target.media.id === mediaId && target.clipId).map(target => target.clipId!) }

  cancel(): void {
    this.epoch++; clearTimeout(this.timer); this.controller?.abort(); this.backend?.cancelSpeculative()
    this.retryAfter.clear(); this.attempted.clear(); this.prepared.clear(); this.content = []; this.host?.retain([]); this.targets = []; this.last = undefined; this.lastScan = -Infinity
  }

  beforeFrame(document: VideoEditComposition, frame: number, playing: boolean): void {
    clearTimeout(this.timer)
    const last = this.last
    if (!playing || !last || !last.playing || last.document !== document || frame < last.frame - 3 || frame - last.frame > Math.ceil(document.fps)) this.cancel()
    this.last = { frame, playing, document }
  }

  update(document: VideoEditComposition, frame: number, playing: boolean, windows: readonly VideoEditRenderCacheWindow[]): void {
    if (!this.last || this.last.document !== document || frame > this.last.frame || this.last.frame - frame > 3 || this.last.playing !== playing) return
    frame = this.last.frame
    if (playing && performance.now() - this.lastScan < 250) { this.schedule(); return }
    const epoch = this.epoch
    clearTimeout(this.timer)
    // 扫描放在当前帧回执之后；未来片段损坏不能使当前帧失败。
    this.timer = setTimeout(() => {
      if (epoch !== this.epoch || this.host && !this.host.idle()) { this.lastScan = -Infinity; return }
      const started = performance.now()
      this.lastScan = started
      try {
        const targets = videoEditLookaheadTargets(document, frame, playing, windows)
        this.backend?.log('debug', '前瞻窗口扫描', 'video_edit.decode.lookahead.scan', { durationMs: performance.now() - started, video: targets.video.length, content: targets.content.length })
        this.content = targets.content
        this.host?.retain(this.content)
        const contentKeys = new Set(this.content.map(target => target.key))
        for (const key of this.prepared) if (!contentKeys.has(key)) this.prepared.delete(key)
        this.targets = targets.video.map(target => ({ ...target, media: this.mapMedia(target.media) })).filter(target => this.backend?.reads(target.media))
        const wanted = new Set(this.targets.map(keyOf))
        for (const key of this.attempted) if (!wanted.has(key)) this.attempted.delete(key)
        this.schedule()
      } catch (error) { this.backend?.log('debug', '前瞻来源扫描失败', 'video_edit.decode.preopen.failed', { reason: String(error), durationMs: performance.now() - started }) }
    }, playing ? 0 : 120)
  }

  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.drain() }, 0)
  }

  private async drain(): Promise<void> {
    if (this.running || this.host && !this.host.idle()) return
    this.running = true
    const epoch = this.epoch
    try {
      const distances = new Map<string, number>()
      for (const target of this.targets) distances.set(target.media.path, Math.min(distances.get(target.media.path) ?? Infinity, target.distance))
      if (performance.now() - this.maintainedAt >= 500) { this.maintainedAt = performance.now(); await this.backend?.maintain(distances, new Map(this.targets.map(target => [keyOf(target), true]))) }
      if (epoch === this.epoch && (!this.host || this.host.idle())) {
        const target = this.targets.find(target => !this.attempted.has(keyOf(target)) && (this.retryAfter.get(keyOf(target)) ?? 0) <= performance.now() && this.backend?.needsPreopen(target.media, target.purpose))
        const content = this.content.find(target => !this.prepared.has(target.key) && (this.retryAfter.get(target.key) ?? 0) <= performance.now())
        if (content && (!target || content.distance <= target.distance)) {
          this.prepared.add(content.key)
          const controller = new AbortController(); this.controller = controller
          try { if (!await this.host?.prepare(content, controller.signal)) { this.prepared.delete(content.key); this.retryAfter.set(content.key, performance.now() + 500) } }
          catch (error) { if (controller.signal.aborted) this.prepared.delete(content.key); else this.backend?.log('debug', '内容前瞻未完成', 'video_edit.decode.content.failed', { clipId: content.clip.id, reason: String(error) }) }
          return
        }
        const backend = this.backend
        if (!target || !backend) return
        const key = keyOf(target), started = performance.now()
        this.attempted.add(key)
        const controller = new AbortController(); this.controller = controller
        if (!await backend.canPreopen()) {
          this.attempted.delete(key); this.retryAfter.set(key, performance.now() + 500)
          this.backend?.log('debug', '预算不足，放弃推测预打开', 'video_edit.decode.preopen.skipped', { mediaId: target.media.id, reason: 'budget', durationMs: performance.now() - started })
          return
        }
        if (epoch !== this.epoch || controller.signal.aborted || this.host && !this.host.idle()) { this.attempted.delete(key); this.backend?.log('debug', '前台优先，推迟前瞻', 'video_edit.decode.preopen.skipped', { reason: 'foreground' }); return }
        this.backend?.log('debug', '提前打开解码会话', 'video_edit.decode.preopen.start', { mediaId: target.media.id, purpose: target.purpose, sourceSeconds: target.time, distanceSeconds: target.distance, durationMs: 0 })
        const reservation = backend.preopen(target.media, { ...target, signal: controller.signal, openOnly: true })
        try {
          await reservation.ready
          this.backend?.log('debug', '解码会话已提前打开', 'video_edit.decode.preopen.completed', { mediaId: target.media.id, purpose: target.purpose, durationMs: performance.now() - started })
        } catch (error) {
          const cancelled = error instanceof Error && error.name === 'AbortError'
          const budget = videoEditNativeFailureKind(error) === 'budget'
          this.backend?.log('debug', '推测预打开未完成', budget ? 'video_edit.decode.preopen.skipped' : 'video_edit.decode.preopen.failed', { mediaId: target.media.id, reason: budget ? 'budget' : cancelled ? 'cancelled' : String(error), durationMs: performance.now() - started })
          if (cancelled) this.attempted.delete(key)
        } finally { reservation.release() }
      }
    } catch (error) {
      this.backend?.log('debug', '前瞻队列未完成', 'video_edit.decode.preopen.failed', { reason: String(error), durationMs: 0 })
    } finally {
      this.running = false; this.controller = undefined
      if ((!this.host || this.host.idle()) && (this.targets.some(target => !this.attempted.has(keyOf(target)) && (this.retryAfter.get(keyOf(target)) ?? 0) <= performance.now() && this.backend?.needsPreopen(target.media, target.purpose)) || this.content.some(target => !this.prepared.has(target.key) && (this.retryAfter.get(target.key) ?? 0) <= performance.now()))) this.schedule()
    }
  }
}
