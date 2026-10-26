import { videoEditGainMultiplier } from '@/core/videoEdit/loudness'
import type { VideoEditContentTarget, VideoEditLookaheadScope } from './videoEditDecodeLookahead'
import { codeMediaInputKey, codeMediaInputComposition } from '@/core/videoEdit/codeMediaInput'
import { codeFilterInputComposition } from '@/core/videoEdit/codeFilterInput'
import type { AuthorGpuInputs } from './videoEditAuthorModule'
import type { PreparedVideoEditCodeEffect, PreparedVideoEditEffect } from './videoEditCodeSources'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { traceVideoEditFrame } from './videoEditFrameTrace'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import { VideoEditContentAudio } from './videoEditContentAudio'
import { codeAudioComposition, codeAudioReferenceMediaId, codeAudioTime } from '@/core/videoEdit/codeAudio'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { createLogger } from '@/core/logging'
import { videoEditShaderGraphWarmSpecs } from '@/core/videoEdit/shaderGraph/effects'
import { isShaderGraphTransition, shaderGraphTransitionSpec } from '@/core/videoEdit/shaderGraph/transitions'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { videoEditMotionBlurSamples, type VideoEditMotionSampledClip } from '@/core/videoEdit/motionBlur'
import { evaluateVideoEditClip, evaluateVideoEditBuiltinParameters, videoEditClipValue } from '@/core/videoEdit/keyframes'
import { videoEditClipMedia, videoEditNestedComposition, videoEditDuration, activeVideoEditClips, audibleVideoEditClips, clipSourceSeconds, videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditNestedFrame, videoEditNestedPictureFrame, videoEditNestedPictureKey } from '@/core/videoEdit/nestedSequences'
import { assertVideoEditSequenceGraph, VIDEO_EDIT_MAX_SEQUENCE_DEPTH } from '@/core/videoEdit/sequenceGraph'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { videoEditNestedAudio } from './videoEditNestedAudio'
import { videoEditPictureSeconds } from '@/core/videoEdit/time'
import { videoEditClipAudioMode, videoEditClipHeadRoomSeconds, videoEditClipSourceSecondsAtTime } from '@/core/videoEdit/clipSpeed'
import { mixVideoEditRetimedSound, type VideoEditRetimedSoundRequest } from './videoEditRetimedAudio'
import { mixVideoEditStretchedSound, VideoEditTimeStretcher } from './videoEditTimeStretch'
import { videoEditRenderedFrameInterpolation } from '@/core/videoEdit/timeRemap'
import { videoEditCaptionClips } from '@/core/videoEdit/timedContent'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { planAudioEffectBlock, AudioEffectChain } from '@/core/audio/effects/audioEffectChain'
import { videoEditAudioMixer, videoEditPanGains, type VideoEditAudioMixer } from '@/core/videoEdit/audioMixer'

/** 一次混音里用到的解码源、效果链与拉伸器（用完后据此回收没用到的）。 */
interface AudioMixSets { activeAudio: Set<string>; activeChains: Set<string>; activeStretchers: Set<string> }
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import type { VideoEditCodeSources } from './videoEditCodeSources'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'
import type { VideoEditClipAudio, VideoEditClipFrames, VideoEditDecodedPicture, VideoEditFrameBackend, VideoEditFrameSeeker, VideoEditFrameSource } from './videoEditFrameSource'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'
import { videoEditAudioTransitionClipGain, videoEditHandleFrame, videoEditTransitionMedium, videoEditTransitionWindow, videoEditTransitionsAt, type VideoEditTransitionWindow } from '@/core/videoEdit/transitions'
import { videoEditClipFades, videoEditFadeGain, videoEditFadeOpacity } from '@/core/videoEdit/fades'
import { applyVideoEditClipFollow, applyVideoEditStabilization, videoEditClipTrackingQuad } from './videoEditTrackResults'
import { activeVideoEditAudioEffects, activeVideoEditEffects, buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import { videoEditAudioMixReads, videoEditDefaultAudioGains } from '@/core/videoEdit/audioChannels'
import { readVideoEditExportPicture } from './videoEditExportPictures'
import { isVideoEditRenderDivisor, videoEditRenderSize, type VideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'
import { applyVideoEditParameterUpdate, type VideoEditParameterUpdate } from './videoEditParameterUpdate'

interface PlaybackStream {
  demux: string
  /** Stops the decode when the schedule is dropped, so a seek does not wait for an armed GOP decode to finish. */
  abort: AbortController
  entries: Array<{ frame: number; clipId: string }>
  cursor: number
  /** The decoder file was handed back after the stream's last picture. */
  released?: boolean
  /** Initial contiguous pictures already owned by the bounded seek cache. */
  cachedUntilFrame: number
  samples: AsyncGenerator<VideoEditDecodedPicture | null, void, unknown>
  /** 当前播放段的首帧；原生未来片段由 Worker 按预算预定位。 */
  primed?: Promise<IteratorResult<VideoEditDecodedPicture | null, void>>
  /** Serializes pulls; one file never serves two clips at the same frame. */
  tail: Promise<unknown>
}
/** `plan`: the planned frames of a nested schedule (ascending) and the parent clip they belong to; undefined means every frame in [start, endFrame). */
interface PlaybackSchedule { document: VideoEditComposition; endFrame: number; streams: PlaybackStream[]; byClip: Map<string, PlaybackStream>; plan?: { key: string; frames: readonly number[] }; cacheRevision: number }
/** A ready pre-rendered window: its file (fetchable URL for the worker) and the frames it covers. */
/**
 * 拖动播放头的取帧方式：`true` 精确拖动；`'fast'` 快速拖动，必须重新定位才能到精确画面时先给目标所在关键帧，
 * 结果带 `approximate`，节目在指针停住或松手后再按精确方式补一次。
 */
export type VideoEditScrubMode = boolean | 'fast'
/** 拖动播放头混音时保留的空闲声音来源（含嵌套序列的声音渲染器）上限。 */
export const VIDEO_EDIT_IDLE_AUDIO_SOURCES = 8
/** 浏览器回退路径的闲置读取器上限；原生会话按服务端预算保留，不使用此数量。 */
export const VIDEO_EDIT_IDLE_SCRUB_RENDERERS = 4
/** 拖动播放头时保留的空闲已解码图片上限（另受 256MiB 图片预算约束）。 */
export const VIDEO_EDIT_IDLE_SCRUB_IMAGES = 6

/**
 * 按最近使用维护空闲表：`idle` 是本次未用到的键（按当前顺序），返回超出 `limit` 后应释放的最旧键，并把它们从表中移除。
 * 本次用到的键不在 `idle` 里，会从表中移除（再次变空闲时重新计为最近）。
 */
export function retireIdle(table: Map<string, true>, idle: readonly string[], limit: number): string[] {
  const current = new Set(idle)
  for (const key of [...table.keys()]) if (!current.has(key)) table.delete(key)
  for (const key of idle) if (!table.has(key)) table.set(key, true)
  const evict = [...table.keys()].slice(0, Math.max(0, table.size - limit))
  for (const key of evict) table.delete(key)
  return evict
}

export interface VideoEditRenderCacheWindow { key: string; startFrame: number; endFrame: number; url: string; width: number; height: number; fps: number }
interface CodeInputSession { renderer: VideoEditRenderer; tail: Promise<unknown>; document: VideoEditComposition; sourceKey: string; lastKey?: string; lastPicture?: VideoEditCodePicture; ownerKey: string }
interface NestedFrameContext { pictures: Map<string, Promise<VideoEditCodePicture>>; keys: Map<string, Set<string>>; inputs: Map<VideoEditRenderer, Map<string, Promise<VideoEditCodePicture>>>; bytes: number }
interface NestedRender {
  context: NestedFrameContext; key: string; path: string[]; ownerKey?: string; opaqueBackground?: boolean; format?: VideoEditCodePicture['textureFormat']; sourceDocument?: VideoEditComposition; filterHandles?: { clipId: string; windows: VideoEditTransitionWindow[] }
  /**
   * Forward playback of a retimed parent clip visits child frames with gaps (2× speed: 0, 2, 4…) or repeats
   * (slow motion, frame holds). The ascending child frames the parent will ask for next, so the child schedules
   * exactly those pictures instead of re-positioning its decoder on every non-consecutive frame.
   */
  playbackPlan?: { key: string; frames: () => readonly number[] }
}
/**
 * Rounding edge of nearest-sample reads: half a sample plus a margin far above floating-point noise, so a clip whose
 * phase lies exactly half-way between two samples picks the same neighbour in every mix block.
 */
const logger = createLogger('features.videoEdit.effects')
const NEAREST_SAMPLE_EDGE = 0.5 + 1e-6
/** Separates a clip id from the sound stream number in a mapped clip's sound source key (`audio:<clip>\0<stream>`). */
const AUDIO_STREAM_KEY = '\u0000'
/** 帧混合第二个读取器的源键后缀（与片段 ID 组合）。 */
const BLEND_PARTNER_KEY = '~blend'
// Bound per-frame timestamp allocation independently of sequence duration. Rebuild as playback crosses this rolling window.
// Rebuilding repositions every decoder at once (a visible stall), so the window spans a whole long-form edit; a file's
// stream opens its decoder half a second before its first frame and releases it after its last.
const PLAYBACK_SCHEDULE_SECONDS = 1800
const PLAYBACK_ARM_IDLE_MS = 2500
/** Frames a forward request may step back (pictures still in flight or just shown) without rebuilding the schedule. */
const PLAYBACK_REPEAT_FRAMES = 3
/** A playback clock that fell behind skips ahead this far at most inside one schedule; the skipped pictures are released unused. */
const PLAYBACK_MAX_SKIP_SECONDS = 1
interface VideoSource {
  /** Key of the shared opened source this clip's own readers read from. */
  demux: string
  media: VideoEditMedia
  video?: VideoEditClipFrames
  audio?: VideoEditClipAudio
  iterator?: AsyncGenerator<VideoEditDecodedPicture, void, unknown>
  current?: VideoEditDecodedPicture | VideoEditGpuFrame
  previousTime: number
  codec?: string
  /** First picture of an upcoming cut, decoded before the boundary frame is requested. */
  prerolled?: Promise<void>
}
/** One bounded decoder per visible clip; all inputs close when the view detaches. */
export class VideoEditRenderer {
  private readonly nestedPictures = new Map<string, { renderer: VideoEditRenderer; tail: Promise<unknown> }>()
  private readonly nestedSounds = new Map<string, VideoEditRenderer>()
  /** 最近一次混音时仍在用的声音来源与嵌套声音（键：'audio:…' 来源键或嵌套片段 ID）按最近使用排序，空闲超出上限才释放。 */
  private readonly idleAudio = new Map<string, true>()
  /** 拖动播放头时暂留的空闲素材定位会话（按素材路径）与嵌套序列渲染器（按片段键），按最近使用排序。 */
  private readonly idleSeekers = new Map<string, true>()
  private readonly idleNested = new Map<string, true>()
  private readonly idleImages = new Map<string, true>()
  private readonly codeInputs = new Map<string, CodeInputSession>()
  private readonly filterInputs = new Map<string, CodeInputSession>()
  private readonly sources = new Map<string, Promise<VideoSource>>()
  private playback?: PlaybackSchedule
  private lastForwardFrame?: number
  /** The paused frame a playback schedule was built for ahead of play (see `armPlayback`). */
  private armedFrame?: number
  private armExpiry?: ReturnType<typeof setTimeout>
  private readonly images = new Map<string, { path: string; controller: AbortController; pending: Promise<ImageBitmap>; bytes: number; ready: boolean; predecoded?: boolean }>()
  private imageLoads = 0
  private readonly imageQueue: Array<() => void> = []
  private disposed = false
  private readonly frameCache: VideoEditFrameCache
  private readonly seekers = new Map<string, VideoEditFrameSeeker>()
  readonly canvas: OffscreenCanvas
  private compositor?: VideoEditGpuCompositor
  private capturePresentation?: (pixels: Promise<ImageBitmap>) => void
  private codeSources?: VideoEditCodeSources
  private readonly contentAudio = new VideoEditContentAudio(document => new VideoEditRenderer(document, 1, undefined, 1, this.frames))
  private presentationEpoch = 0
  /** Pre-rendered preview windows (forward playback of the top-level program only), as full-frame clips of their files. */
  private renderCache: Array<{ startFrame: number; endFrame: number; clip: VideoEditClip; media: VideoEditMedia }> = []
  private renderCacheRevision = 0
  /**
   * Replaces the ready pre-rendered windows. Playback shows a window's file instead of composing its layers;
   * paused frames, scrubbing, observation and export always compose live.
   */
  setRenderCache(windows: ReadonlyArray<VideoEditRenderCacheWindow>): void {
    this.renderCache = windows.map(window => {
      // 文件可以复用，时间线上的读取器必须有独立身份，否则重复段会沿用上一段的源时钟。
      const id = `render-cache:${window.key}:${window.startFrame}`
      const media: VideoEditMedia = { id, name: '预渲染', path: window.url, kind: 'video', width: window.width, height: window.height, durationSeconds: (window.endFrame - window.startFrame) / window.fps, hasAudio: false }
      const clip: VideoEditClip = { id, itemId: id, name: '预渲染', kind: 'video', track: Number.MAX_SAFE_INTEGER, start: window.startFrame, duration: window.endFrame - window.startFrame, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
      return { startFrame: window.startFrame, endFrame: window.endFrame, clip, media }
    }).sort((a, b) => a.startFrame - b.startFrame)
    this.renderCacheRevision++
  }
  /** The ready window drawing this frame during forward playback of the program, if any. */
  private cachedWindow(frame: number): { clip: VideoEditClip; media: VideoEditMedia } | undefined {
    if (!this.previewWidth || this.nestedOwner) return undefined
    let low = 0, high = this.renderCache.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1, window = this.renderCache[middle]
      if (frame < window.startFrame) high = middle - 1
      else if (frame >= window.endFrame) low = middle + 1
      else return window
    }
    return undefined
  }
  /** A clip's source media, including the files of pre-rendered windows. */
  private clipMedia(document: VideoEditComposition, clip: VideoEditClip): VideoEditMedia | undefined {
    return clip.id.startsWith('render-cache:') ? this.renderCache.find(window => window.clip.id === clip.id)?.media : videoEditClipMedia(document, clip)
  }
  private ensureCompositor(): VideoEditGpuCompositor {
    if (this.disposed) throw new DOMException('剪辑渲染已关闭。', 'AbortError')
    if (!this.compositor) { this.compositor = this.nestedOwner?.compositor?.fork(this.canvas, () => this.capturePresentation) ?? new VideoEditGpuCompositor(this.canvas, undefined, () => this.capturePresentation, (durationMs, stage = 'ready') => this.timing?.(`compositor.${stage}`, durationMs), () => this.onPlaybackIdle?.()); if (this.renderDivisor !== 1) this.compositor.setPictureDivisor(this.renderDivisor) }
    return this.compositor!
  }
  /** Image media decoded ahead for code clips about to start; kept until those clips draw them (or the warm-up expires). */
  private readonly warmImages = new Set<string>()
  private readonly warmScopes = new Set<string>()
  onPlaybackIdle?: () => void
  private speculativeImageLoads = 0
  private get lookaheadOwner(): VideoEditRenderer { return this.nestedOwner?.lookaheadOwner ?? this }
  private lookaheadRenderers(): VideoEditRenderer[] {
    const renderers = new Set<VideoEditRenderer>([this])
    for (const renderer of renderers) for (const entry of [...renderer.nestedPictures.values(), ...renderer.codeInputs.values(), ...renderer.filterInputs.values()]) renderers.add(entry.renderer)
    return [...renderers]
  }
  get waitingForPresentation(): boolean { return this.compositor?.waitingForPresentation === true }
  readonly lookaheadMetrics = { imagePrepared: 0, imageHits: 0, codePrepared: 0, codeHits: 0, budgetSkipped: 0 }
  private nestedPicture(child: VideoEditComposition, key: string): { renderer: VideoEditRenderer; tail: Promise<unknown> } {
    const owner = this.nestedOwner ?? this
    let entry = owner.nestedPictures.get(key)
    if (!entry) {
      const renderer = new VideoEditRenderer(child, this.previewWidth, undefined, 64 * 1024 ** 2, this.frames, owner)
      renderer.setRenderDivisor(this.renderDivisor)
      entry = { renderer, tail: Promise.resolve() }; owner.nestedPictures.set(key, entry)
    }
    return entry
  }
  private lookaheadRenderer(scopes: readonly VideoEditLookaheadScope[], create: boolean): VideoEditRenderer | undefined {
    return scopes.reduce<VideoEditRenderer | undefined>((renderer, scope) => {
      if (!renderer) return undefined
      if (scope.input && scope.parent) {
        let entry = renderer.codeInputs.get(scope.key)
        if (!entry && create) {
          const child = new VideoEditRenderer(scope.document, undefined, undefined, 1, this.frames, renderer, renderer.sequencePath)
          entry = { renderer: child, tail: Promise.resolve(), document: scope.parent, sourceKey: scope.input.sampleKey, ownerKey: `code-input:${scope.key}` }
          renderer.codeInputs.set(scope.key, entry)
        }
        return entry?.renderer
      }
      const owner = renderer.nestedOwner ?? renderer
      return (create ? renderer.nestedPicture(scope.document, scope.key) : owner.nestedPictures.get(scope.key))?.renderer
    }, this)
  }
  /** 仅保护当前窗口内的缓存；切换/停止后撤销保护，由正常渲染清理资源。 */
  retainLookahead(targets: readonly VideoEditContentTarget[]): void {
    this.warmScopes.clear(); this.warmImages.clear()
    for (const renderer of this.lookaheadRenderers()) renderer.warmImages.clear()
    for (const target of targets) {
      for (const scope of target.scopes) this.warmScopes.add(scope.key)
      if (target.media) this.lookaheadRenderer(target.scopes, false)?.warmImages.add(target.media.id)
    }
  }
  /** 只做模块/元数据和图片准备，不渲染废弃帧，不向节目 GPU 队列插入作者绘制。 */
  async prepareLookahead(target: VideoEditContentTarget, signal: AbortSignal): Promise<boolean> {
    if (this.disposed || signal.aborted) return false
    if (target.media && this.lookaheadRenderer(target.scopes, false)?.images.has(target.media.id)) return true
    if (target.media && this.speculativeImageLoads > 0) { this.lookaheadMetrics.budgetSkipped++; return false }
    const renderers = this.lookaheadRenderers()
    const bytes = renderers.reduce((sum, renderer) => sum + [...renderer.images.values()].reduce((sum, image) => sum + image.bytes, 0), 0)
    if (renderers.length >= 12 && !this.lookaheadRenderer(target.scopes, false) || target.media && bytes + target.media.width * target.media.height * 4 > 256 * 1024 ** 2) { this.lookaheadMetrics.budgetSkipped++; return false }
    const renderer = this.lookaheadRenderer(target.scopes, true)!
    if (target.media) {
      renderer.warmImages.add(target.media.id)
      if (renderer.images.has(target.media.id)) return true
      await renderer.image(target.media, true, signal)
      this.lookaheadMetrics.imagePrepared++
    } else {
      const compositor = renderer.ensureCompositor()
      const { VideoEditCodeSources } = await import('./videoEditCodeSources')
      if (signal.aborted || renderer.disposed) return false
      renderer.codeSources ??= new VideoEditCodeSources(renderer.document, () => compositor.code(), undefined, () => { this.lookaheadMetrics.codeHits++ })
      this.lookaheadMetrics.codePrepared += await renderer.codeSources.prepareAhead(target.document, [target.clip], signal)
    }
    return true
  }
  /** Only devices/pipelines: no project media, render targets or sound are opened during workspace warmup. */
  async prepareGpu(): Promise<void> { await this.ensureCompositor().prepare() }
  async renderAuthorFrame(...args: Parameters<VideoEditGpuCompositor['renderAuthorFrame']>): ReturnType<VideoEditGpuCompositor['renderAuthorFrame']> {
    return this.ensureCompositor().renderAuthorFrame(...args)
  }
  async readAuthorMetadata(...args: Parameters<VideoEditGpuCompositor['readAuthorMetadata']>): ReturnType<VideoEditGpuCompositor['readAuthorMetadata']> {
    return this.ensureCompositor().readAuthorMetadata(...args)
  }
  async releaseAuthor(url: string): Promise<void> { await this.compositor?.releaseAuthor(url) }
  async prepareContent(frame: number, current: () => boolean): Promise<void> {
    const document = this.document
    const clips = activeVideoEditClips(document, frame).filter(clip => clip.kind === 'code' || activeVideoEditEffects(clip).some(effect => effect.code))
    if (!clips.length || !current()) return
    const compositor = this.ensureCompositor()
    await compositor.prepare()
    const { VideoEditCodeSources } = await import('./videoEditCodeSources')
    if (!current()) return
    this.codeSources ??= new VideoEditCodeSources(document, () => compositor.code(), undefined, () => { this.lookaheadOwner.lookaheadMetrics.codeHits++ })
    await this.codeSources.prepare(document, clips, frame, current, undefined, { preparationOnly: true })
  }
  /** Preview only (task 4.9): the canvas, composition targets and owned pictures are 1/divisor of the sequence size. */
  private renderDivisor: VideoEditRenderDivisor = 1
  /** High-precision composition counters and, with `row`, that row of the last high-precision frame before 8-bit quantization (task 2.7 acceptance). */
  async precisionDiagnostics(row?: number): Promise<{ counters?: ReturnType<VideoEditGpuCompositor['precisionDiagnostics']>; row?: Uint16Array }> {
    return { counters: this.compositor?.precisionDiagnostics(), row: row === undefined ? undefined : await this.compositor?.readPreciseRow(row) }
  }
  codePerformance(): import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] { return this.compositor?.codePerformance() ?? [] }
  captureCodePerformance(): () => import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] { return this.compositor?.captureCodePerformance() ?? (() => []) }
  observeAuthorElements(frame: number): import('@/core/videoEdit/codeAuthorProgram').CodeAuthorFrameObservation {
    return this.codeSources?.observeElements(frame) ?? { sequenceId: this.document.id, revision: this.document.revision, frame, clips: [] }
  }
  codeDiagnostics() { return { sources: this.codeSources?.diagnostics(), gpu: this.compositor?.codeDiagnostics(), images: this.compositor?.imageDiagnostics(), decodedImages: this.images.size, decodedImageBytes: [...this.images.values()].reduce((sum, entry) => sum + entry.bytes, 0), imageDecodes: this.imageLoads, codeInputSessions: this.codeInputs.size } }
  /** `frames` is the only decoding dependency; the renderer never touches a decoder implementation. */
  constructor(public document: VideoEditComposition, private readonly previewWidth?: number, surface?: OffscreenCanvas, cacheBudgetBytes = 8 * 1024 ** 3, private readonly frames: VideoEditFrameBackend = new VideoEditBrowserFrames(), private readonly nestedOwner?: VideoEditRenderer, private sequencePath: string[] = [document.id], private readonly timing?: (stage: string, durationMs?: number) => void) {
    if (document.sequences) assertVideoEditSequenceGraph({ items: document.items, sequences: document.sequences })
    if (!Number.isSafeInteger(cacheBudgetBytes) || cacheBudgetBytes < 1 || cacheBudgetBytes > 8 * 1024 ** 3) throw new Error('预览缓存预算无效。')
    this.frameCache = new VideoEditFrameCache(cacheBudgetBytes)
    this.canvas = surface ?? new OffscreenCanvas(document.width, document.height)
    this.canvas.width = document.width; this.canvas.height = document.height
  }
  /** The sequence as the GPU draws it: the reduced canvas size, every other field (and so every placement ratio) unchanged. */
  private drawDocument(document: VideoEditComposition): VideoEditComposition {
    if (this.renderDivisor === 1) return document
    return { ...document, ...videoEditRenderSize(document.width, document.height, this.renderDivisor) }
  }
  private resizeCanvas(): void {
    const { width, height } = videoEditRenderSize(this.document.width, this.document.height, this.renderDivisor)
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height }
  }
  /**
   * Playback resolution of the preview (task 4.9). Pictures cached at the previous size are dropped, so a paused frame
   * that returns to full resolution is decoded again instead of showing a reduced picture. Export never calls this.
   */
  setRenderDivisor(divisor: number): void {
    if (!isVideoEditRenderDivisor(divisor)) throw new Error('回放分辨率无效。')
    if (!this.previewWidth && divisor !== 1) throw new Error('导出始终按完整分辨率渲染。')
    if (divisor === this.renderDivisor) return
    this.renderDivisor = divisor
    this.compositor?.setPictureDivisor(divisor)
    this.frameCache.clear()
    this.resizeCanvas()
    for (const entry of this.nestedPictures.values()) entry.renderer.setRenderDivisor(divisor)
  }
  /** Drops one user of the shared opened file; a clip's own sound reader closes with its source. */
  private release(source: Pick<VideoSource, 'demux'> & Partial<Pick<VideoSource, 'audio'>>): void { source.audio?.close?.(); this.frames.release(source.demux) }
  private source(key: string, media: VideoEditMedia, audioStream?: number): Promise<VideoSource> {
    let source = this.sources.get(key)
    if (!source) {
      const demux = this.frames.open(media)
      source = (async () => {
        try {
          const shared = await demux.ready
          if (this.disposed) throw new Error('预览已关闭。')
          return { demux: demux.key, media, video: shared.clipFrames(), audio: shared.clipAudio(audioStream), previousTime: -1, codec: shared.codec }
        } catch (error) { this.release({ demux: demux.key }); if (this.sources.get(key) === source) this.sources.delete(key); throw error }
      })()
      this.sources.set(key, source)
    }
    return source
  }
  private image(media: VideoEditMedia, speculative = false, signal?: AbortSignal): Promise<ImageBitmap> {
    let image = this.images.get(media.id)
    if (!image) {
      const controller = new AbortController()
      const cancel = (): void => controller.abort()
      signal?.addEventListener('abort', cancel, { once: true })
      const load = async (): Promise<ImageBitmap> => {
        const started = performance.now()
        const response = await fetch(media.path, { signal: controller.signal }); if (!response.ok) throw videoEditSourceReadError(media.name, new Error(String(response.status)))
        const bitmap = await createImageBitmap(await response.blob())
        recordVideoEditPreparation(speculative ? 'lookaheadImageDecode' : 'imageDecode', performance.now() - started)
        return bitmap
      }
      // 推测解码独占自己的单并发许可，不能排在节目两条前台图片许可之前。
      const owner = this.lookaheadOwner
      if (speculative) owner.speculativeImageLoads++
      const native = (speculative ? load() : this.boundedImageLoad(controller.signal, load)).finally(() => {
        signal?.removeEventListener('abort', cancel)
        if (speculative) owner.speculativeImageLoads--
      }).then(bitmap => {
        if (this.disposed || controller.signal.aborted || this.images.get(media.id)?.pending !== pending) { bitmap.close(); throw new DOMException('原图片已取消。', 'AbortError') }
        if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 8192 || bitmap.height > 8192) { bitmap.close(); throw new Error('图片边长须在1到8192像素之间。') }
        const bytes = bitmap.width * bitmap.height * 4
        const others = (): number => [...this.images].reduce((sum, [id, image]) => sum + (id === media.id ? 0 : image.bytes), 0)
        // 超预算时先释放拖动中暂留的空闲图片（最旧的先），仍放不下才报错。
        for (const key of [...this.idleImages.keys()]) { if (others() + bytes <= 256 * 1024 ** 2) break; this.idleImages.delete(key); this.releaseImage(key) }
        if (others() + bytes > 256 * 1024 ** 2) { bitmap.close(); throw new Error('解码图片超过256MiB预算，请减少同时显示的图片。') }
        const entry = this.images.get(media.id)!; entry.bytes = bytes; entry.ready = true; entry.predecoded = speculative
        return bitmap
      })
      let abort!: () => void
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(controller.signal.reason ?? new DOMException('原图片已取消。', 'AbortError')); controller.signal.addEventListener('abort', abort, { once: true }) })
      const pending = Promise.race([native, cancelled]).catch(error => { if (this.images.get(media.id)?.pending === pending) this.images.delete(media.id); throw error }).finally(() => controller.signal.removeEventListener('abort', abort))
      // A detached asynchronous decoder may finish after the worker closes.
      void pending.catch(() => {})
      image = { path: media.path, controller, pending, bytes: media.width * media.height * 4, ready: false }
      this.images.set(media.id, image)
    }
    return image.pending
  }
  private async boundedImageLoad<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (this.imageLoads >= 2) await new Promise<void>((resolve, reject) => {
      const next = (): void => { signal.removeEventListener('abort', cancel); resolve() }
      const cancel = (): void => { const index = this.imageQueue.indexOf(next); if (index >= 0) { this.imageQueue.splice(index, 1); signal.removeEventListener('abort', cancel); reject(signal.reason) } }
      this.imageQueue.push(next); signal.addEventListener('abort', cancel, { once: true })
    })
    else this.imageLoads++
    // A native bitmap decode retains its permit even after consumer cancellation.
    try { signal.throwIfAborted(); return await operation() }
    finally { const next = this.imageQueue.shift(); if (next) next(); else this.imageLoads-- }
  }
  private releaseImage(id: string): void {
    const image = this.images.get(id); if (!image) return
    this.images.delete(id); image.controller.abort()
    // Successful cached bitmaps close here; a late decoder closes in image().
    void image.pending.then(bitmap => bitmap.close(), () => {})
  }
  /** Clear mutable per-request state, retaining only content-keyed preparation. */
  async replaceContent(document: VideoEditComposition): Promise<void> {
    this.cancelPresentation(); await this.disposePlayback()
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source) }))
    this.sources.clear(); this.frameCache.clear(); this.contentAudio.clear()
    for (const chain of this.audioChains.values()) chain.dispose()
    this.audioChains.clear(); this.stretchers.clear()
    await this.codeSources?.replaceContent(document)
    await this.updateDocument(document)
  }
  async updateDocument(document: VideoEditComposition): Promise<void> {
    if (document.id !== this.document.id) {
      // 只有顶层节目渲染器可以换序列（同尺寸序列间切换复用 Worker 与 GPU，免去重建的等待）；嵌套渲染器绑定在自己的序列上。
      if (this.sequencePath.length > 1) throw new Error('渲染目标剪辑已经改变。')
      // 片段级的解码源、播放流与音频效果链属于上一个序列，全部释放；按媒体路径共享的帧缓存与解码器保留。
      this.cancelPresentation(); await this.disposePlayback()
      await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source) }))
      this.sources.clear()
      for (const chain of this.audioChains.values()) chain.dispose()
      this.audioChains.clear(); this.stretchers.clear()
      this.sequencePath = [document.id]
    }
    if (document.sequences) assertVideoEditSequenceGraph({ items: document.items, sequences: document.sequences })
    await Promise.allSettled([...this.nestedPictures.values()].map(entry => entry.renderer.dispose()))
    await Promise.allSettled([...this.nestedSounds.values()].map(renderer => renderer.dispose()))
    this.nestedPictures.clear(); this.nestedSounds.clear()
    await this.disposeCodeInputs()
    await this.disposeCodeInputs(new Set(), this.filterInputs)
    this.codeSources?.updateDocument(document)
    this.cancelPresentation()
    for (const [path, seeker] of this.seekers) if (!document.media.some(media => media.path === path)) { this.seekers.delete(path); await seeker.dispose() }
    for (const media of this.document.media) if (!document.media.some(item => item.id === media.id && item.path === media.path && item.sourceRevision === media.sourceRevision && item.width === media.width && item.height === media.height)) {
      this.releaseImage(media.id)
      const seeker = this.seekers.get(media.path)
      if (seeker) { this.seekers.delete(media.path); await seeker.dispose() }
      this.frameCache.deleteMedia(media.path)
    }
    for (const [key, pending] of this.sources) {
      const source = await pending.catch(() => undefined)
      if (!source) { this.sources.delete(key); continue }
      const clip = document.clips.find(clip => clip.id === (key.startsWith('audio:') ? key.slice(6).split(AUDIO_STREAM_KEY)[0] : key))
      const media = clip ? videoEditClipMedia(document, clip) : undefined
      if (!media || media.id !== source.media.id || media.path !== source.media.path || media.sourceRevision !== source.media.sourceRevision) {
        this.sources.delete(key); source.current?.close(); await source.iterator?.return(); this.release(source)
      }
    }
    this.document = document
    this.resizeCanvas()
  }
  /** Preserve decoder, uploaded source pictures, nested sessions and playback schedules during parameter gestures. */
  updateParameters(update: VideoEditParameterUpdate): void {
    this.document = applyVideoEditParameterUpdate(this.document, update)
    if (this.playback) this.playback.document = this.document
    this.codeSources?.updateParameters(this.document)
    for (const entry of this.nestedPictures.values()) entry.renderer.updateParameters({ ...update, baseRevision: entry.renderer.document.revision })
    for (const renderer of this.nestedSounds.values()) renderer.updateParameters({ ...update, baseRevision: renderer.document.revision })
  }
  /** 打开剪辑、加效果或转场后，在后台把新出现的着色器图先编译好（见 ShaderGraphCache.warm）。 */
  private warmShaderGraphs(): void {
    const compositor = this.compositor
    if (!compositor) return
    const specs = videoEditShaderGraphWarmSpecs([this.document], kind => isShaderGraphTransition(kind) ? shaderGraphTransitionSpec(kind) : undefined)
    if (specs.length) void compositor.code().then(code => code.shaderGraphs().warm(specs)).catch(() => undefined)
  }
  /** Newly imported/replaced fonts must rebuild cached glyphs and nested text surfaces. */
  async invalidateFontResources(): Promise<void> {
    this.cancelPresentation()
    await this.codeSources?.dispose(); this.codeSources = undefined
    await this.compositor?.invalidateFontResources()
    for (const entry of this.nestedPictures.values()) await entry.renderer.invalidateFontResources()
    for (const entry of [...this.codeInputs.values(), ...this.filterInputs.values()]) { entry.lastKey = undefined; entry.lastPicture = undefined; await entry.renderer.invalidateFontResources() }
  }
  cancelPresentation(): void {
    this.presentationEpoch++; this.codeSources?.cancel(); this.compositor?.cancelPresentation()
    for (const entry of this.nestedPictures.values()) entry.renderer.cancelPresentation()
    for (const renderer of this.nestedSounds.values()) renderer.cancelPresentation()
    for (const entry of [...this.codeInputs.values(), ...this.filterInputs.values()]) entry.renderer.cancelPresentation()
    for (const [id, image] of this.images) if (!image.ready) this.releaseImage(id)
  }
  /**
   * Forward playback reads every frame of a file through one `samplesAtTimestamps` decoder: a cut back into the
   * same file flushes and re-seeks that decoder instead of allocating a new hardware decoder mid-playback
   * (a new D3D11 decoder blocks the GPU main thread for tens of milliseconds while it creates picture buffers).
   * Built at the first frame of a play run, so that frame is the first scheduled picture (one positioning, one GOP).
   */
  private buildPlayback(document: VideoEditComposition, frame: number, visible: Set<number>, plan?: NestedRender['playbackPlan']): void {
    const frames = plan?.frames().filter(value => value >= frame)
    const endFrame = frames ? (frames.at(-1) ?? frame) + 1 : frame + Math.ceil(document.fps * PLAYBACK_SCHEDULE_SECONDS)
    const groups = new Map<string, { media: VideoEditMedia; clips: VideoEditClip[] }>()
    const cached = this.previewWidth && !this.nestedOwner ? this.renderCache : []
    for (const clip of [...document.clips, ...cached.map(window => window.clip)]) {
      // 倒放片段的源时间逐帧后退，不进前向解码排程，走定位路径（GOP 缓存，4.13）。
      if (clip.kind !== 'video' || clip.reverse || !(visible.has(clip.track) || clip.id.startsWith('render-cache:')) || clip.start + clip.duration <= frame || clip.start >= endFrame) continue
      const media = this.clipMedia(document, clip)
      if (!media || media.kind !== 'video') continue
      const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
      const group = groups.get(key) ?? { media, clips: [] }; group.clips.push(clip); groups.set(key, group)
    }
    const streams: PlaybackStream[] = []; const byClip = new Map<string, PlaybackStream>()
    const ordered = [...groups.values()].map(group => ({ ...group, clips: group.clips.sort((a, b) => a.start - b.start) }))
      .filter(group => group.clips.every((clip, index) => index === 0 || group.clips[index - 1].start + group.clips[index - 1].duration <= clip.start))
      .sort((a, b) => a.clips[0].start - b.clips[0].start)
    // A source reused after a timeline gap must not retain its prefetched native frames through that gap.
    const runs = ordered.flatMap(group => {
      const chunks: VideoEditClip[][] = []
      for (const clip of group.clips) {
        const previous = chunks.at(-1)?.at(-1)
        if (!previous || previous.start + previous.duration < clip.start) chunks.push([])
        chunks.at(-1)!.push(clip)
      }
      return chunks.map(clips => ({ media: group.media, clips }))
    })
    for (const group of runs) {
      const entries: PlaybackStream['entries'] = []; const timestamps: number[] = []
      const add = (clip: VideoEditClip, at: number): void => {
        // A pre-rendered window replaces every layer at its frames; its own clip is scheduled only there.
        if (!clip.id.startsWith('render-cache:') && this.cachedWindow(at)) return
        entries.push({ frame: at, clipId: clip.id }); timestamps.push(videoEditPictureSeconds(clipSourceSeconds(clip, at, document.fps)))
      }
      for (const clip of group.clips) {
        if (frames) { for (const at of frames) if (at >= clip.start && at < clip.start + clip.duration) add(clip, at) }
        else for (let at = Math.max(frame, clip.start); at < Math.min(endFrame, clip.start + clip.duration); at++) add(clip, at)
      }
      // A scrub already decoded this prefix. Play those exact pictures while the existing decoder
      // positions at the first uncached picture, instead of decoding the same GOP before moving at all.
      // Borrow only from the existing budget: no pinned window, new textures or extra decoder.
      let cachedFrames = 0
      const limit = Math.min(Math.ceil(document.fps / 2), entries.length - 1)
      while (cachedFrames < limit && entries[cachedFrames].frame === frame + cachedFrames
        && entries[cachedFrames].clipId === entries[0].clipId
        && this.frameCache.get(group.media.path, timestamps[cachedFrames]) instanceof VideoEditGpuFrame) cachedFrames++
      if (cachedFrames < Math.ceil(document.fps / 4)) cachedFrames = 0
      const cachedUntilFrame = frame + cachedFrames
      if (cachedFrames) { entries.splice(0, cachedFrames); timestamps.splice(0, cachedFrames) }
      const demux = this.frames.open(group.media)
      // Observe early open failures; the first actual pull still awaits and reports the same rejected promise.
      void demux.ready.catch(() => undefined)
      const abort = new AbortController()
      const samples = (async function* (ready: Promise<VideoEditFrameSource>) { yield* (await ready).schedule(timestamps, abort.signal) })(demux.ready)
      const stream: PlaybackStream = { demux: demux.key, abort, entries, cursor: 0, cachedUntilFrame, samples, tail: Promise.resolve() }
      if (group.clips.some(clip => clip.start <= frame && frame < clip.start + clip.duration)) {
        stream.primed = samples.next()
        void stream.primed.catch(() => undefined)
      }
      streams.push(stream); for (const clip of group.clips) byClip.set(clip.id, stream)
    }
    this.playback = { document, endFrame, streams, byClip, cacheRevision: this.renderCacheRevision, ...(plan && frames ? { plan: { key: plan.key, frames } } : {}) }
  }
  /** The frames this renderer will be asked for next while playing forward (the parent's plan when nested and retimed). */
  private upcomingFrames(frame: number, end: number): number[] {
    const planned = this.playback?.plan?.frames
    if (planned) return planned.filter(value => value >= frame && value < end)
    return Array.from({ length: Math.max(0, Math.min(end, frame + Math.ceil(this.document.fps * PLAYBACK_SCHEDULE_SECONDS)) - frame) }, (_, index) => frame + index)
  }
  /** Whether a sequential frame continues the current schedule: the next frame, a repeat, or a skip ahead within it. */
  private continuesPlayback(frame: number, planKey?: string): boolean {
    const last = this.lastForwardFrame, playback = this.playback
    // A frame just before the last one is a repeated request of a picture already shown (a restarted play command
    // presents its current frame again): it keeps the schedule and reads the played picture back from the frame cache.
    if (last === undefined || !playback || frame < last - PLAYBACK_REPEAT_FRAMES || frame >= playback.endFrame || playback.plan?.key !== planKey || playback.cacheRevision !== this.renderCacheRevision) return false
    return frame - last <= 1 || !!playback.plan || frame - last <= Math.ceil(this.document.fps * PLAYBACK_MAX_SKIP_SECONDS)
  }
  /** Briefly position the active decoder ahead of play, including the handoff after the scrub cache.
   * Expiry retires the entire armed schedule; a long pause and future runs hold no borrowed frames. */
  async armPlayback(frame: number): Promise<void> {
    if (this.disposed || !this.previewWidth) return
    if (this.playback && this.armedFrame === frame && this.playback.document === this.document) return
    if (this.playback) await this.disposePlayback()
    this.buildPlayback(this.document, frame, videoEditVisibleTracks(this.document))
    this.armedFrame = frame; this.lastForwardFrame = frame - 1
    const playback = this.playback
    this.armExpiry = setTimeout(() => {
      if (this.playback === playback && this.armedFrame !== undefined) void this.disposePlayback().catch(error => {
        logger.debug('起播预热释放失败', { event: 'video_edit.preview.arm_release_failed', error })
      })
    }, PLAYBACK_ARM_IDLE_MS)
    this.warmShaderGraphs()
  }
  private async disposePlayback(): Promise<void> {
    clearTimeout(this.armExpiry); this.armExpiry = undefined
    this.armedFrame = undefined
    const playback = this.playback; this.playback = undefined
    if (!playback) return
    for (const stream of playback.streams) stream.abort.abort()
    await Promise.allSettled(playback.streams.map(async stream => {
      await stream.tail.catch(() => undefined)
      const primed = stream.primed; stream.primed = undefined
      if (primed) (await primed.catch(() => undefined))?.value?.close()
      await stream.samples.return(); if (!stream.released) this.release(stream)
    }))
  }
  async stopPlayback(): Promise<void> {
    this.lastForwardFrame = undefined
    await this.disposePlayback()
    await Promise.all([...this.nestedPictures.values(), ...this.codeInputs.values(), ...this.filterInputs.values()].map(entry => entry.renderer.stopPlayback()))
  }
  /**
   * A cut onto another scheduled file must not open and position its decoder on the boundary frame (a 4K long-GOP
   * start costs tens of milliseconds). Start decoding its first picture half a second ahead; runs further away
   * still borrow nothing from the native frame pool.
   */
  private primeUpcomingStreams(frame: number): void {
    if (this.frames.managesIdleSessions) return
    const horizon = frame + Math.ceil(this.document.fps / 2)
    for (const stream of this.playback?.streams ?? []) {
      const first = stream.entries[0]
      if (stream.primed || stream.cursor !== 0 || !first || first.frame <= frame || first.frame > horizon) continue
      // One file has one playback decoder: a new run must not cancel a run of the same file still being shown.
      if (this.playback!.streams.some(other => other !== stream && other.demux === stream.demux && !other.released && (other.cursor > 0 || other.primed))) continue
      stream.primed = stream.samples.next()
      void stream.primed.catch(() => undefined)
    }
  }
  /** The scheduled picture for exactly this frame and clip, or undefined to use the regular path. */
  private takeScheduled(stream: PlaybackStream, frame: number, clipId: string): Promise<VideoEditDecodedPicture | undefined> {
    const pull = (): Promise<IteratorResult<VideoEditDecodedPicture | null, void>> => {
      const primed = stream.primed; stream.primed = undefined
      return primed ?? stream.samples.next()
    }
    const next = stream.tail.catch(() => undefined).then(async () => {
      while (stream.cursor < stream.entries.length && stream.entries[stream.cursor].frame < frame) {
        stream.cursor++; const skipped = await pull(); skipped.value?.close()
      }
      const entry = stream.entries[stream.cursor]
      if (!entry || entry.frame !== frame || entry.clipId !== clipId) return undefined
      stream.cursor++
      const result = await pull()
      // Finish the generator before the timeline leaves this contiguous run; its last picture belongs to the caller.
      if (stream.cursor === stream.entries.length) { await stream.samples.return(); stream.released = true; this.release(stream) }
      return result.done || !result.value ? undefined : result.value
    })
    stream.tail = next
    return next
  }
  private upcomingVideoClips(document: VideoEditComposition, frame: number, visible: Set<number>): VideoEditClip[] {
    const horizon = frame + Math.ceil(document.fps / 2)
    return document.clips.filter(clip => clip.kind === 'video' && visible.has(clip.track) && clip.start > frame && clip.start <= horizon).slice(0, 2)
  }
  private preroll(clip: VideoEditClip, document: VideoEditComposition): void {
    if (this.sources.has(clip.id) || this.playback?.byClip.has(clip.id)) return
    const media = videoEditClipMedia(document, clip)
    if (!media || media.kind !== 'video') return
    const time = videoEditPictureSeconds(clipSourceSeconds(clip, clip.start, document.fps))
    const pending = this.source(clip.id, media)
    void pending.then(source => {
      if (!source.video || source.iterator || source.prerolled) return
      const iterator = source.video.frames(time)
      source.iterator = iterator
      source.prerolled = (async () => {
        const next = await iterator.next()
        if (this.disposed || this.sources.get(clip.id) !== pending || source.iterator !== iterator) { if (!next.done) next.value.close(); return }
        if (!next.done) { source.current?.close(); source.current = next.value; source.previousTime = time }
      })().catch(() => undefined).finally(() => { source.prerolled = undefined })
    }, () => undefined)
  }
  private async disposeCodeInputs(keep: ReadonlySet<string> = new Set(), sessions = this.codeInputs): Promise<void> {
    await Promise.allSettled([...sessions].filter(([key]) => !keep.has(key)).map(async ([key, entry]) => {
      sessions.delete(key)
      await entry.renderer.dispose()
      await entry.tail.catch(() => undefined)
    }))
  }
  /** Neighbour inputs are prefix renders on this worker/device. Each prefix has
   * its own targets so recursive predecessors cannot overwrite the current input. */
  private async readFilterFrames(document: VideoEditComposition, clip: VideoEditClip, plan: PreparedVideoEditCodeEffect, input: VideoEditCodePicture, frame: number, quality: EffectQuality, current: () => boolean, context: NestedFrameContext, path: string[], sourceDocument: VideoEditComposition): Promise<AuthorGpuInputs['frames']> {
    const sessionKey = JSON.stringify([clip.id, plan.effect.id])
    let entry = this.filterInputs.get(sessionKey)
    if (!entry) {
      const source = codeFilterInputComposition(document, clip.id, plan.effect.id)
      const renderer = new VideoEditRenderer(source, this.previewWidth, undefined, 1, this.frames, this, this.sequencePath)
      renderer.setRenderDivisor(this.renderDivisor)
      entry = { renderer, tail: Promise.resolve(), document, sourceKey: '', ownerKey: `filter-input:${document.id}:${sessionKey}` }
      this.filterInputs.set(sessionKey, entry)
    }
    const session = entry
    if (session.document !== document) {
      await session.tail.catch(() => undefined)
      await session.renderer.updateDocument(codeFilterInputComposition(document, clip.id, plan.effect.id))
      session.document = document
    }
    let shared = context.inputs.get(session.renderer)
    if (!shared) { shared = new Map(); context.inputs.set(session.renderer, shared) }
    const frames: Array<AuthorGpuInputs['frames'][number]> = []
    for (const offset of plan.program.frames) {
      if (!current()) throw new DOMException('滤镜相邻帧已取消。', 'AbortError')
      if (offset === 0) { frames.push({ offset, texture: input.texture, available: true }); continue }
      const sample = frame + offset
      const windows = videoEditTransitionsAt(sourceDocument, sample).filter(window => window.left.id === clip.id || window.right.id === clip.id)
      const available = sample >= 0 && (sample >= clip.start && sample < clip.start + clip.duration || windows.length > 0)
      const key = JSON.stringify([quality, input.textureFormat, available ? sample : 'blank'])
      let pending = shared.get(key)
      if (!pending) {
        context.bytes += input.width * input.height * (input.textureFormat === 'rgba16float' ? 8 : 4)
        if (context.bytes > 512 * 1024 ** 2) throw new Error('滤镜相邻帧与嵌套画面超过显存预算，请减少同时读取的画面。')
        const targetKey = `nested:frame:filter:${key}`
        const keys = context.keys.get(session.ownerKey) ?? new Set<string>(); keys.add(targetKey); context.keys.set(session.ownerKey, keys)
        pending = session.tail.catch(() => undefined).then(async () => {
          if (!current()) throw new DOMException('滤镜相邻帧已取消。', 'AbortError')
          if (!available) {
            const compositor = session.renderer.ensureCompositor()
            const picture = await (await compositor.code()).target(targetKey, input.width, input.height, input.textureFormat)
            const result = await compositor.draw(this.drawDocument(document), [], [], current, undefined, picture)
            await result.completion
            if (!result.presented || !current()) throw new DOMException('滤镜相邻帧已取消。', 'AbortError')
            return picture
          }
          const result = await session.renderer.render(sample, false, false, current, undefined, { context, key: targetKey, ownerKey: session.ownerKey, path, format: input.textureFormat, sourceDocument, filterHandles: { clipId: clip.id, windows } }, quality)
          if (result.effectErrors?.length) throw new Error(result.effectErrors.join('\n'))
          if (!result.presented || !result.nestedPicture || !current()) throw new DOMException('滤镜相邻帧已取消。', 'AbortError')
          await result.completion
          return result.nestedPicture
        })
        session.tail = pending; shared.set(key, pending)
      }
      frames.push({ offset, texture: (await pending).texture, available })
    }
    return frames
  }
  /** Input sessions borrow the parent device, while owning their render targets
   * and decoder positions. A frame's alias map shares the exact submitted texture;
   * no canvas readback, bitmap copy or external upload is required. */
  private async prepareCodeInputs(document: VideoEditComposition, active: VideoEditClip[], frame: number, sequential: boolean, quality: EffectQuality, current: () => boolean, context: NestedFrameContext, path: string[]): Promise<Map<string, VideoEditCodePicture>> {
    const requests = active.flatMap(clip => Object.entries(clip.code?.parameters ?? {}).flatMap(([parameter, reference]) => isCodeImageReference(reference) && reference.kind !== 'image' ? [{ clip, parameter, reference, source: codeMediaInputComposition(document, clip, reference, frame) }] : []))
    const keep = new Set([...requests.map(request => request.source.sessionKey), ...(this.nestedOwner ?? this).warmScopes])
    if (keep.size > 32) throw new Error('同时读取的视频画面超过32份，请减少输入。')
    await this.disposeCodeInputs(keep)
    let shared = context.inputs.get(this)
    if (!shared) { shared = new Map(); context.inputs.set(this, shared) }
    const inputs = new Map<string, VideoEditCodePicture>()
    for (const { clip, parameter, reference, source } of requests) {
      if (!current()) throw new DOMException('视频取帧已取消。', 'AbortError')
      const sampleKey = JSON.stringify([quality, sequential, source.sampleKey]), key = JSON.stringify([source.sessionKey, sampleKey])
      let picture = shared.get(key)
      if (!picture) {
        context.bytes += source.document.width * source.document.height * 8
        if (context.bytes > 512 * 1024 ** 2) throw new Error('当前视频输入与嵌套画面超过显存预算，请减少同时读取的画面。')
        let entry = this.codeInputs.get(source.sessionKey)
        if (!entry) {
          const began = performance.now()
          const renderer = new VideoEditRenderer(source.document, undefined, undefined, 1, this.frames, this, this.sequencePath)
          entry = { renderer, tail: Promise.resolve(), document, sourceKey: source.sampleKey, ownerKey: `code-input:${source.sessionKey}` }; this.codeInputs.set(source.sessionKey, entry)
          recordVideoEditPreparation('codeInputRenderer', performance.now() - began)
        }
        const session = entry, targetKey = `nested:frame:input:${sampleKey}`
        const keys = context.keys.get(session.ownerKey) ?? new Set<string>(); keys.add(targetKey); context.keys.set(session.ownerKey, keys)
        picture = session.tail.catch(() => undefined).then(async () => {
          if (!current()) throw new DOMException('视频取帧已取消。', 'AbortError')
          if (session.lastKey === sampleKey && session.lastPicture && (reference.kind === 'video' || session.document === document)) { recordVideoEditPreparation('codeInputFrameHit', 0); return session.lastPicture }
          // The next preparation may retire the prior target before submission.
          // A cancelled or failed new frame must never resurrect that texture.
          session.lastKey = undefined; session.lastPicture = undefined
          const started = performance.now()
          if (reference.kind === 'video' && session.sourceKey !== source.sampleKey || session.document !== document) {
            session.lastKey = undefined; session.lastPicture = undefined
            await session.renderer.updateDocument(source.document)
            session.sourceKey = source.sampleKey; session.document = document
          }
          const result = await session.renderer.render(source.frame, false, false, current, undefined, { context, key: targetKey, ownerKey: session.ownerKey, path, opaqueBackground: true }, quality)
          if (!current() || !result.presented || !result.nestedPicture) throw new DOMException('旧视频输入画面已取消。', 'AbortError')
          await result.completion
          if (!current()) throw new DOMException('旧视频输入画面已取消。', 'AbortError')
          session.lastKey = sampleKey; session.lastPicture = result.nestedPicture; session.document = document
          recordVideoEditPreparation('codeInputRender', performance.now() - started)
          return result.nestedPicture
        })
        session.tail = picture; shared.set(key, picture)
      } else recordVideoEditPreparation('codeInputFrameHit', 0)
      inputs.set(codeMediaInputKey(clip.id, parameter), await picture)
    }
    for (const entry of this.codeInputs.values()) (await entry.renderer.compositor?.code())?.releaseNestedFrames(context.keys.get(entry.ownerKey) ?? new Set())
    return inputs
  }
  /**
   * `blankPictures` counts video layers with no picture at their source time (drawn transparent, no timestamp).
   * A sequential render without a preview width is an export frame (task 2.4): every video layer shows the exact
   * picture at its source time or the frame fails (`videoEditExportPictures.ts`); `singleFrameReads` counts the layers
   * a single-frame read decided because the sequential reader's picture was not exact.
   */
  async render(frame: number, sequential = false, _scrubbing: VideoEditScrubMode = false, shouldPresent: () => boolean = () => true, deadline?: number, nestedRender?: NestedRender, quality: EffectQuality = 'interactive', capturePresentation?: (pixels: Promise<ImageBitmap>) => void): Promise<{ canvas: OffscreenCanvas; nestedPicture?: VideoEditCodePicture; sourceTimestamps: number[]; blankPictures: number; singleFrameReads: number; cacheHits: number; cacheBytes: number; presented: boolean; renderCached: boolean; decodeMs: number; gpuMs: number; effectErrors?: string[]; approximate?: boolean; completion: Promise<void> }> {
    this.capturePresentation = capturePresentation
    if (this.disposed) throw new Error('预览已关闭。')
    const document = this.document; const epoch = this.presentationEpoch
    // A filter prefix limits visible passes, not audio, tracking or explicit media references.
    const sourceDocument = nestedRender?.sourceDocument ?? document
    const nestedContext: NestedFrameContext = nestedRender?.context ?? { pictures: new Map(), keys: new Map(), inputs: new Map(), bytes: 0 }
    const path = nestedRender?.path ?? [document.id]
    const canPresent = (): boolean => !this.disposed && this.document === document && this.presentationEpoch === epoch && shouldPresent()
    const visible = videoEditVisibleTracks(document)
    if (this.previewWidth && sequential) {
      clearTimeout(this.armExpiry); this.armExpiry = undefined
      const forward = this.continuesPlayback(frame, nestedRender?.playbackPlan?.key)
      // Resolution changes and cache pressure can remove a prefix after arming. Rebuild the
      // same playback plan at this frame instead of opening a second reader for the missing prefix.
      // Pre-rendered windows are scheduled clips too: a missing prefix picture of one rebuilds the plan as well.
      const missingPrefix = this.playback && [...document.clips, ...this.renderCache.map(window => window.clip)].some(clip => {
        const stream = this.playback?.byClip.get(clip.id)
        if (!stream || frame >= stream.cachedUntilFrame || frame < clip.start || frame >= clip.start + clip.duration) return false
        const media = this.clipMedia(document, clip)
        return !media || !(this.frameCache.get(media.path, videoEditPictureSeconds(clipSourceSeconds(clip, frame, document.fps))) instanceof VideoEditGpuFrame)
      })
      if (this.playback && (this.playback.document !== document || !forward || missingPrefix)) { recordVideoEditPreparation(missingPrefix ? 'playbackDropPrefix' : !forward ? 'playbackDropJump' : 'playbackDropDocument', 0); await this.disposePlayback() }
      if (!this.playback) recordVideoEditPreparation('playbackBuild', 0)
      // A sequential preview render is always forward playback (reverse play, single steps and scrubbing render
      // non-sequentially), so its first frame already builds the schedules and takes its picture from them. Waiting for
      // a second consecutive frame made the first one open a sequential reader that decoded the GOP up to the start,
      // and then the schedule decoded the same GOP again on its own session (task 3.6 F1: 0.6–2.4s mid-file start-up
      // of long-GOP 4K material). A sequential frame before the previous one is not playback: it keeps the seek path
      // and its frame cache.
      if (!this.playback && !(this.lastForwardFrame !== undefined && frame < this.lastForwardFrame)) this.buildPlayback(document, frame, visible, nestedRender?.playbackPlan)
      this.lastForwardFrame = forward ? Math.max(frame, this.lastForwardFrame!) : frame; this.armedFrame = undefined
      this.primeUpcomingStreams(frame)
    } else if (this.armedFrame !== frame || this.playback?.document !== document) { this.lastForwardFrame = undefined; if (this.playback) await this.disposePlayback() }
    const cachedWindow = sequential && !nestedRender ? this.cachedWindow(frame) : undefined
    const rawTransitions = cachedWindow ? [] : videoEditTransitionsAt(document, frame).filter(window => visible.has(window.left.track))
    // 淡化手柄（PR）：片段首尾按帧乘上淡入淡出的不透明度，合成、效果与导出都用这一份。
    const candidates = new Map(cachedWindow ? [[cachedWindow.clip.id, cachedWindow.clip]] : activeVideoEditClips(document, frame).filter(clip => clip.kind !== 'audio').map(clip => [clip.id, clip]))
    // A predecessor render needs the owner's source handle, not the outgoing /
    // incoming transition mix (which belongs after the complete effect chain).
    const filterHandles = nestedRender?.filterHandles
    if (filterHandles?.windows.length) {
      const owner = document.clips.find(clip => clip.id === filterHandles.clipId)
      if (owner) candidates.set(owner.id, owner)
    }
    const transitionIds = new Set(rawTransitions.flatMap(window => [window.left.id, window.right.id]))
    for (const window of rawTransitions) for (const clip of [window.left, window.right]) candidates.set(clip.id, clip)
    // 防抖修正在关键帧与跟随之后合成进位置、缩放、旋转（预览与导出同一份）。
    const active = (await applyVideoEditStabilization(sourceDocument, (await applyVideoEditClipFollow(sourceDocument, [...candidates.values()], frame)).map(clip => {
      const evaluated = evaluateVideoEditClip(clip, frame)
      return videoEditClipFades(clip) ? { ...evaluated, opacity: evaluated.opacity * videoEditFadeOpacity(clip, frame) } : evaluated
    }), frame)).filter(clip => !['code', 'graphic'].includes(clip.kind) || clip.opacity > 0 || activeVideoEditEffects(clip).length || transitionIds.has(clip.id))
    // 运动模糊（序列开关）：有变换动画的画面片段带上快门内的取样变换，合成器平均后叠到画面上（预览与导出同一份）。
    if (document.motionBlur) for (const [index, clip] of active.entries()) {
      const source = candidates.get(clip.id)
      if (!source || clip.kind === 'adjustment' || videoEditClipTrackingQuad(clip)) continue
      const motionSamples = videoEditMotionBlurSamples(document, source, clip, frame)
      if (motionSamples) active[index] = { ...clip, motionSamples } as VideoEditMotionSampledClip
    }
    const byId = new Map(active.map(clip => [clip.id, clip]))
    const transitions = rawTransitions.map(window => ({ ...window, left: byId.get(window.left.id)!, right: byId.get(window.right.id)! }))
    if (!cachedWindow) active.push(...videoEditCaptionClips(document, frame))
    const composite = transitions.length || active.some(clip => clip.kind === 'adjustment' || activeVideoEditEffects(clip).length) ? buildVideoEditCompositePlan(active, transitions) : undefined
    const timestamps: number[] = []
    const gpu = this.ensureCompositor()
    const effectErrors: string[] = []
    const onEffectError = (effect: VideoEditEffect, error: unknown): void => {
      const message = `效果“${effect.name}”无法应用，已跳过；请重置参数或修改滤镜源码。`
      if (!effectErrors.includes(message)) effectErrors.push(message)
      logger.warn(message, { event: 'video_edit.effect.render_failed', error, context: { sequenceId: document.id, effectId: effect.id, frame } })
    }
    const decodeStart = performance.now()
    if (!this.codeSources && (composite || active.some(clip => ['code', 'graphic'].includes(clip.kind) || activeVideoEditEffects(clip).length))) {
      const { VideoEditCodeSources } = await import('./videoEditCodeSources')
      if (this.disposed) throw new DOMException('剪辑渲染已关闭。', 'AbortError')
      this.codeSources ??= new VideoEditCodeSources(document, () => this.compositor!.code(), undefined, () => { this.lookaheadOwner.lookaheadMetrics.codeHits++ })
    }
    const imageIds = new Set(active.flatMap(clip => [...codeMaterialImageIds(clip.code), ...activeVideoEditEffects(clip).flatMap(effect => [...codeMaterialImageIds(effect.code)]), ...(clip.kind === 'image' ? [videoEditClipMedia(document, clip)?.id ?? ''] : [])]))
    const imageMedia = [...imageIds].map(id => {
      const media = document.media.find(media => media.id === id && ['image', 'video'].includes(media.kind))
      if (!media) throw new Error('代码图片引用或图片片段的源素材不存在。')
      return media
    }).filter(media => media.kind === 'image')
    if (imageMedia.length > 32 || imageMedia.reduce((sum, media) => sum + media.width * media.height * 4, 0) > 256 * 1024 ** 2) throw new Error('可见图片超过32份或256MiB预算，请减少同时显示的图片。')
    for (const id of imageIds) {
      this.warmImages.delete(id)
      const image = this.images.get(id)
      if (image?.predecoded) { image.predecoded = false; this.lookaheadOwner.lookaheadMetrics.imageHits++ }
    }
    for (const id of this.images.keys()) if (!imageIds.has(id) && !this.warmImages.has(id)) this.releaseImage(id)
    const imagesReady = (async () => {
      const inputs = new Map<string, ImageBitmap | VideoEditCodePicture>(await Promise.all(imageMedia.map(async media => [media.id, await this.image(media)] as const)))
      for (const [key, picture] of await this.prepareCodeInputs(sourceDocument, active, frame, sequential, quality, canPresent, nestedContext, path)) inputs.set(key, picture)
      return await this.compositor!.prepareImages(inputs, canPresent, new Set(active.filter(clip => clip.kind === 'text').map(clip => clip.id)), new Set(active.map(clip => clip.id)))
    })()
    const imagesSettled = Promise.allSettled([imagesReady])
    const surfaceKeys = composite ? videoEditCompositeSurfaceKeys(composite) : new Set<string>()
    for (const key of nestedContext.keys.get(nestedRender?.ownerKey ?? document.id) ?? []) surfaceKeys.add(key)
    const codeReady = this.codeSources?.prepare(document, active, frame, canPresent, imagesReady, { transitions: [...transitions, ...(filterHandles?.windows ?? [])], surfaceKeys, onEffectError, audio: async (clip, program, parameters, signal) => {
      if (!codeMaterialUsesAudio(program)) return {}
      const source = codeAudioComposition(sourceDocument, sourceDocument.clips.find(value => value.id === clip.id) ?? clip, codeAudioReferenceMediaId(parameters))
      const audio = await this.contentAudio.analyze(source.document, source.start, source.duration, signal)
      return { audio, audioTime: codeAudioTime(clip, frame, document.fps) }
    } })
    const codeSettled = codeReady ? Promise.allSettled([codeReady]) : Promise.resolve([])
    this.frameCache.setHotFrames(active.flatMap(clip => {
      const media = this.clipMedia(document, clip)
      return clip.kind === 'video' && media ? [{ mediaId: media.path, time: videoEditPictureSeconds(clipSourceSeconds(clip, videoEditHandleFrame(clip, frame, document.fps, media.durationSeconds), document.fps)) }] : []
    }))
    // A cut opens a new demuxer/decoder; doing that on the boundary frame stalls playback.
    // Open and decode the first picture of clips starting within half a second ahead of time.
    const upcoming = sequential && this.previewWidth && !this.frames.managesIdleSessions ? this.upcomingVideoClips(document, frame, visible) : []
    for (const clip of upcoming) this.preroll(clip, document)
    let cacheHits = 0
    let blankPictures = 0
    /** 快速拖动时以关键帧近似显示的图层数（含嵌套序列里的）；大于 0 时节目在指针停住后补精确帧。 */
    let approximatePictures = 0
    let singleFrameReads = 0
    const picturesPending = active.map(async clip => {
      if (clip.kind === 'sequence') {
        const child = videoEditNestedComposition(document, clip)!
        if (path.includes(child.id) || path.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('嵌套序列存在循环或超过可渲染层数。')
        const childFrame = videoEditNestedPictureFrame(document, clip, child, frame)
        const childKey = videoEditNestedPictureKey(child, clip)
        const key = `${quality}:${childKey}:${childFrame}`
        let picture = nestedContext.pictures.get(key)
        if (!picture) {
          const size = videoEditRenderSize(child.width, child.height, this.renderDivisor)
          nestedContext.bytes += size.width * size.height * 8
          if (nestedContext.bytes > 512 * 1024 ** 2) throw new Error('当前嵌套画面超过显存预算，请降低回放分辨率或减少同时显示的嵌套片段。')
          const entry = this.nestedPicture(child, childKey)
          const targetKey = `nested:frame:${childFrame}`
          const keys = nestedContext.keys.get(childKey) ?? new Set<string>(); keys.add(targetKey); nestedContext.keys.set(childKey, keys)
          const renderer = entry.renderer
          const playing = sequential && !clip.reverse
          // The parent's upcoming frames mapped through this clip's speed: the child schedules exactly the pictures it will show.
          const playbackPlan = playing && this.previewWidth ? {
            key: JSON.stringify([nestedRender?.playbackPlan?.key, clip.id, clip.start, clip.duration, clip.sourceInUs, clip.sourceRemainder, clip.speed, clip.timeRemap, clip.frameInterpolation]),
            frames: (): number[] => {
              const frames: number[] = []
              for (const at of this.upcomingFrames(frame, clip.start + clip.duration)) {
                const mapped = videoEditNestedFrame(document, clip, child, at)
                if (mapped > (frames.at(-1) ?? -1)) frames.push(mapped)
              }
              return frames
            },
          } : undefined
          picture = entry.tail.catch(() => undefined).then(async () => {
            const nestedStarted = performance.now()
            const result = await renderer.render(childFrame, playing, _scrubbing, canPresent, undefined, { context: nestedContext, key: targetKey, path: [...path, child.id], ownerKey: childKey, ...(playbackPlan ? { playbackPlan } : {}) }, quality)
            if (!result.presented || !result.nestedPicture) throw new DOMException('旧嵌套画面已取消。', 'AbortError')
            effectErrors.push(...(result.effectErrors ?? []))
            if (!nestedRender) recordVideoEditPreparation('nestedRender', performance.now() - nestedStarted)
            timestamps.push(...result.sourceTimestamps); blankPictures += result.blankPictures; singleFrameReads += result.singleFrameReads; if (result.approximate) approximatePictures++
            return result.nestedPicture
          })
          entry.tail = picture; nestedContext.pictures.set(key, picture)
        } else cacheHits++
        return picture
      }
      const media = this.clipMedia(document, clip)
      if (clip.kind === 'text' || clip.kind === 'adjustment') return null
      if (clip.kind === 'code' || clip.kind === 'graphic') {
        const codeWait = performance.now()
        const picture = (await codeReady)?.pictures.get(clip.id)
        recordVideoEditPreparation('codeReady', performance.now() - codeWait)
        if (!picture) throw new Error(`代码素材 ${clip.name} 没有返回画面。`)
        return picture
      }
      if (!media) throw new Error(`找不到素材 ${clip.name}`)
      if (media.kind === 'image') return this.image(media)
      // 转场让片段越过源素材首尾时重复首尾帧（PR“媒体不足”）。
      const originalTime = clipSourceSeconds(clip, videoEditHandleFrame(clip, frame, document.fps, media.durationSeconds), document.fps)
      // Every picture lookup (schedule, seek, export read) uses the same picture time: the source time plus the container
      // timestamp rounding tolerance (task 3.2, D3), so a picture a container rounded up still shows at its own frame.
      const time = videoEditPictureSeconds(originalTime)
      const pendingSource = this.source(clip.id, media)
      const sourceWait = performance.now()
      const source = await pendingSource
      // Never race a pre-roll on the shared iterator: it would hand this frame the second picture.
      await source.prerolled
      recordVideoEditPreparation('sourceReady', performance.now() - sourceWait)
      if (!source.video) throw new Error(`素材 ${media.name} 没有可解码的视频轨。`)
      const scheduledStream = sequential && this.previewWidth ? this.playback?.byClip.get(clip.id) : undefined
      const cached = scheduledStream && frame < scheduledStream.cachedUntilFrame ? this.frameCache.get(media.path, time) : undefined
      const cachedPicture = cached instanceof VideoEditGpuFrame ? cached.clone() : undefined
      if (cachedPicture) cacheHits++
      // If an intervening allocation evicted a prefix picture, takeScheduled returns undefined for
      // this pre-schedule time and the ordinary exact-picture reader recovers it below.
      const scheduled = cachedPicture ?? (scheduledStream ? await this.takeScheduled(scheduledStream, frame, clip.id) : undefined)
      // A sequential reader started before the stream's first picture hands out that first picture early: it is kept
      // for its own time and nothing shows until then.
      let early = false
      // A backwards source clock must use the shared GOP cache even when the
      // caller requests continuous playback; a forward iterator would re-decode
      // the whole GOP for every preceding picture.
      // Which reader served a playback picture: the schedule, or a fallback that decodes on its own (diagnostics).
      if (scheduledStream) recordVideoEditPreparation(scheduled ? 'pictureScheduled' : 'pictureUnscheduled', 0)
      if (scheduled) {
        await source.iterator?.return(); source.iterator = undefined
        source.current?.close(); source.current = scheduled
      } else if (scheduledStream && source.current && source.current.timestamp <= time + 1e-6 && time < source.current.timestamp + source.current.duration - 1e-7) {
        // A slowed or held parent clip asks for the same source picture again: it is already the current one.
      } else if ((this.previewWidth || clip.reverse) && (!sequential || time < source.previousTime)) {
        // 倒放（4.13）：导出也走定位路径——整段 GOP 解码一次、按时间取“开始于该时刻或之前的最后一幅”（与导出的精确画面同一定义），
        // 不为每一帧重新从关键帧顺序解码。
        await source.iterator?.return(); source.iterator = undefined
        let seeker = this.seekers.get(media.path)
        if (!seeker) { seeker = this.frames.seeker(media, this.frameCache, (sample, compact) => this.compositor!.snapshot(sample, compact)); this.seekers.set(media.path, seeker) }
        const jump = source.previousTime < 0 ? Infinity : Math.abs(time - source.previousTime)
        const direction = jump > 1 ? 0 : Math.sign(time - source.previousTime)
        // 拖动播放头时只取目标这一幅：原生会话在硬件解码器内部从关键帧解到目标、同一 GOP 内向前继续解，
        // 中间各幅不离开原生进程。整窗方式把一秒内每一幅都交给渲染进程导入并复制进缓存，3 个交接槽位使吞吐受导入与复制限制，
        // 4K 长 GOP 原片实测一窗 0.3～0.85 秒（单幅 20～60ms），正是拖动反向与小幅来回时的半秒停顿。
        // 整窗缓存只留给逐帧步进（暂停时方向键前后走）。
        // 新进入画面的图层（还没读过）也只取一幅：拖动中新镜头若走整窗，要先解完一秒才出画面（实测 0.4～0.9 秒）。
        const single = !sequential && (source.previousTime < 0 || _scrubbing !== false)
        const result = await seeker.sample(time, direction, single, _scrubbing === 'fast')
        if (result.hit) cacheHits++
        if (result.approximate) approximatePictures++
        source.current?.close(); source.current = result.sample
      } else if (sequential && !this.previewWidth) {
        // Export: the exact picture at this source time, decided by a single-frame read when the reader's is not.
        const read = await readVideoEditExportPicture(source, source.video, time, media.name)
        early = read.blank; if (read.singleFrameRead) singleFrameReads++
      } else if (sequential || (this.previewWidth && time >= source.previousTime && time - source.previousTime <= 2)) {
        // Preview falls back here when the playback schedule has no picture for this frame (task 3.1). The same exact
        // picture as export: the last one starting at or before the time, decided by a single-frame read when the
        // sequential reader skipped it or holds one past its span; transparent only before the stream's first picture.
        early = (await readVideoEditExportPicture(source, source.video, time, media.name)).blank
      } else {
        source.current?.close(); await source.iterator?.return()
        source.iterator = undefined
        source.current = await source.video.frameAt(time) ?? undefined
      }
      source.previousTime = time
      if (!source.current || early) {
        // No picture at this source time although it is inside the media: the time precedes the stream's first picture
        // (MPEG program/transport streams start after zero on the source timeline, record of 2.1). The layer is
        // transparent there, as in the gap before a clip, instead of failing the whole frame.
        if (originalTime >= media.durationSeconds) throw new Error(`素材 ${media.name} 在此时间没有画面。`)
        blankPictures++
        return this.compositor!.blank(media.width, media.height, originalTime, 1 / document.fps)
      }
      if (!(source.current instanceof VideoEditGpuFrame)) {
        const decoded = source.current
        const normalized = await this.compositor!.snapshot(decoded, videoEditGpuFrameUsesChroma(decoded, source.codec), true)
        if (this.disposed || this.sources.get(clip.id) !== pendingSource) { normalized.close(); decoded.close(); return null }
        source.current = normalized
        // Forward pictures already have the same owned format as seeks. Retain
        // a reference in the existing bounded cache so reversing a played range
        // never starts competing background GOP decodes for those pictures.
        if (this.previewWidth && sequential) this.frameCache.put(media.path, normalized.clone(), new Set())
        decoded.close()
      }
      timestamps.push(source.current.timestamp)
      // 帧混合（时间重映射补帧）：源位置落在两幅源画面之间时，按位置把下一幅混合进来。
      // 只在慢于原速处混合：原速或加速时两幅源画面的间隔不超过一帧，混合只增加解码量（如 59.94 素材放在 60 序列）。
      const slowed = () => Math.abs(clipSourceSeconds(clip, frame + 1, document.fps) - clipSourceSeconds(clip, frame, document.fps)) * document.fps < .995
      // 片段没设补帧方式时跟随序列的“帧混合”开关（重要记录 019）。
      const interpolation = clip.frameInterpolation ?? (document.frameBlend ? 'blend' : undefined)
      if (interpolation && videoEditRenderedFrameInterpolation(interpolation) === 'blend' && !clip.frameHold && slowed()) {
        const current = source.current
        const weight = (originalTime - current.timestamp) / current.duration
        const partnerTime = videoEditPictureSeconds(current.timestamp + current.duration)
        if (weight > 0.01 && weight < 0.99 && partnerTime < media.durationSeconds) {
          const partner = await this.blendPartner(clip.id, media, partnerTime, sequential)
          const mixed = partner && await this.compositor!.blend(current, partner, weight).finally(() => partner.close())
          if (mixed) { this.blendedPictures.get(clip.id)?.close(); this.blendedPictures.set(clip.id, mixed); return mixed }
        }
      }
      return source.current
    })
    const settled = await Promise.allSettled(picturesPending)
    const imageResults = await imagesSettled
    const preparedCode = await codeSettled
    if (!canPresent()) return { canvas: this.canvas, sourceTimestamps: [], blankPictures, singleFrameReads, cacheHits, cacheBytes: this.frameCache.bytes, presented: false, renderCached: !!cachedWindow, decodeMs: performance.now() - decodeStart, gpuMs: 0, completion: Promise.resolve() }
    const codeFailure = preparedCode.find(result => result.status === 'rejected')
    if (codeFailure?.status === 'rejected') throw codeFailure.reason
    if (preparedCode[0]?.status === 'fulfilled') { cacheHits += preparedCode[0].value.cacheHits; timestamps.push(...preparedCode[0].value.sourceTimestamps) }
    const failure = settled.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (imageResults[0].status === 'rejected') throw imageResults[0].reason
    const pictures = settled.map(result => { if (result.status !== 'fulfilled') throw new Error('剪辑画面准备失败。'); return result.value })
    if (this.disposed) throw new Error('预览已关闭。')
    const decodeMs = performance.now() - decodeStart
    const gpuStart = performance.now()
    let result: { presented: boolean; completion: Promise<void> }
    let nestedPicture = nestedRender ? await (await gpu.code()).target(nestedRender.key, this.canvas.width, this.canvas.height, nestedRender.format ?? 'rgba16float') : undefined
    // Code media inputs previously captured the opaque program canvas. Preserve
    // its black letterbox rather than leaking the parent's backdrop through it.
    if (nestedPicture && nestedRender?.opaqueBackground) nestedPicture = new VideoEditCodePicture(nestedPicture.texture, nestedPicture.width, nestedPicture.height, nestedPicture.owner, nestedPicture.textureFormat, true)
    try {
      const drawn = this.drawDocument(document)
      const effects = preparedCode[0]?.status === 'fulfilled' ? preparedCode[0].value.effects : new Map<string, PreparedVideoEditEffect[]>()
      await this.disposeCodeInputs(new Set([...effects].flatMap(([id, chain]) => chain.flatMap(plan => !plan.builtin && plan.program.frames.length ? [JSON.stringify([id, plan.effect.id])] : []))), this.filterInputs)
      result = composite ? await renderVideoEditCompositeScene(drawn, composite, new Map(active.map((clip, index) => [clip.id, pictures[index]])), effects, gpu, frame, canPresent, deadline, document, nestedPicture, onEffectError, quality,
        (clip, plan, input) => this.readFilterFrames(document, clip, plan, input, frame, quality, canPresent, nestedContext, path, sourceDocument)) : await gpu.draw(drawn, active, pictures, canPresent, deadline, nestedPicture)
    } catch (error) {
      if (canPresent()) throw error
      result = { presented: false, completion: Promise.resolve() }
    }
    const { presented, completion } = result
    for (const session of this.filterInputs.values()) (await session.renderer.compositor?.code())?.releaseNestedFrames(nestedContext.keys.get(session.ownerKey) ?? new Set())
    const gpuMs = performance.now() - gpuStart
    traceVideoEditFrame('compositor.record', frame, gpuStart)
    const activeIds = new Set(canPresent() ? [...active, ...upcoming].map(clip => clip.id) : [...this.sources.keys()].filter(key => !key.startsWith('audio:')).map(key => key.split(BLEND_PARTNER_KEY)[0]))
    for (const [id, picture] of this.blendedPictures) if (!activeIds.has(id)) { picture.close(); this.blendedPictures.delete(id) }
    for (const [key, pending] of this.sources) if (!activeIds.has(key.split(BLEND_PARTNER_KEY)[0]) && !key.startsWith('audio:')) {
      this.sources.delete(key); const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source)
    }
    const activeImages = new Set(canPresent() ? [...imageIds, ...this.warmImages] : this.images.keys())
    // 拖动时图片镜头来回进出：保留最近用过的几张已解码图片（大图解码一次要几百毫秒），非拖动时照旧立即释放。
    for (const key of retireIdle(this.idleImages, [...this.images.keys()].filter(key => !activeImages.has(key)), _scrubbing ? VIDEO_EDIT_IDLE_SCRUB_IMAGES : 0)) this.releaseImage(key)
    // A pre-rendered frame keeps the live decoders and nested sequences of the paused picture until playback leaves the
    // cache: closing a native seek decoder held the GPU for about 100ms, a dropped frame at every start of playback.
    const keepLive = !!cachedWindow
    const activePaths = new Set(canPresent() ? active.map(clip => this.clipMedia(document, clip)?.path) : this.seekers.keys())
    // 原生文件会话由共享后端按服务端预算保留，渲染器只释放闲置读取器；浏览器仍用原有 LRU。
    const scrubLimit = this.frames.managesIdleSessions ? 0 : _scrubbing ? VIDEO_EDIT_IDLE_SCRUB_RENDERERS : 0
    if (!keepLive) for (const path of retireIdle(this.idleSeekers, [...this.seekers.keys()].filter(path => !activePaths.has(path)), scrubLimit)) {
      const seeker = this.seekers.get(path); this.seekers.delete(path); await seeker?.dispose()
    }
    if (!nestedRender && !keepLive) {
      for (const [id, entry] of this.nestedPictures) if (nestedContext.keys.has(id)) (await entry.renderer.compositor?.code())?.releaseNestedFrames(nestedContext.keys.get(id)!)
      for (const id of retireIdle(this.idleNested, [...this.nestedPictures.keys()].filter(id => !nestedContext.keys.has(id) && !this.warmScopes.has(id)), scrubLimit)) {
        const entry = this.nestedPictures.get(id); this.nestedPictures.delete(id); await entry?.renderer.dispose()
      }
    }
    return { canvas: this.canvas, ...(nestedPicture ? { nestedPicture } : {}), sourceTimestamps: timestamps, blankPictures, singleFrameReads, cacheHits, cacheBytes: this.frameCache.bytes, presented, renderCached: !!cachedWindow, decodeMs, gpuMs, effectErrors, ...(approximatePictures ? { approximate: true } : {}), completion }
  }
  /** 声音片段的音频效果链（4.7c），按片段 ID；状态跨混音块延续，本块没用到的片段释放。 */
  private readonly audioChains = new Map<string, AudioEffectChain>()
  /** 帧混合的结果画面，按片段 ID（下一帧替换时释放）。 */
  private readonly blendedPictures = new Map<string, VideoEditGpuFrame>()
  /**
   * 帧混合的另一幅源画面（调用方负责 close）：预览先查共享帧缓存、再用定位解码（整段 GOP 解一次，后续帧命中缓存）；
   * 导出用片段自己的第二个顺序读取器，与主画面互不打扰。
   */
  private async blendPartner(clipId: string, media: VideoEditMedia, time: number, sequential: boolean): Promise<VideoEditGpuFrame | undefined> {
    const cached = this.frameCache.get(media.path, time)
    if (cached instanceof VideoEditGpuFrame) return cached.clone()
    let picture: VideoEditDecodedPicture | VideoEditGpuFrame | undefined
    if (this.previewWidth || !sequential) {
      let seeker = this.seekers.get(media.path)
      if (!seeker) { seeker = this.frames.seeker(media, this.frameCache, (sample, compact) => this.compositor!.snapshot(sample, compact)); this.seekers.set(media.path, seeker) }
      picture = (await seeker.sample(time, 1)).sample
    } else {
      const pending = this.source(`${clipId}${BLEND_PARTNER_KEY}`, media)
      const partner = await pending
      if (!partner.video) return undefined
      const read = await readVideoEditExportPicture(partner, partner.video, time, media.name)
      if (read.blank || !partner.current) return undefined
      if (!(partner.current instanceof VideoEditGpuFrame)) {
        const decoded = partner.current
        partner.current = await this.compositor!.snapshot(decoded, videoEditGpuFrameUsesChroma(decoded, partner.codec), true)
        decoded.close()
      }
      return partner.current.clone()
    }
    if (!picture) return undefined
    if (picture instanceof VideoEditGpuFrame) return picture
    const codec = (await this.sources.get(clipId))?.codec
    const normalized = await this.compositor!.snapshot(picture, videoEditGpuFrameUsesChroma(picture, codec), true)
    picture.close()
    return normalized
  }
  /** 保持音调与变调的拉伸器（Signalsmith Stretch），按片段 ID；状态跨混音块延续，本块没用到的片段释放。 */
  private readonly stretchers = new Map<string, Promise<VideoEditTimeStretcher>>()
  /** 变速、倒放、变调片段的声音：保持音调或变调时经拉伸器，否则按位置重采样（磁带式）。 */
  private async mixRetimedSound(clip: VideoEditClip, request: VideoEditRetimedSoundRequest, mode: 'resample' | 'stretch', activeStretchers: Set<string>): Promise<void> {
    if (mode === 'resample') return mixVideoEditRetimedSound(request)
    activeStretchers.add(clip.id)
    let pending = this.stretchers.get(clip.id)
    const existing = pending && await pending.catch(() => undefined)
    if (!existing || existing.channels !== request.channels || existing.rate !== request.rate) {
      pending = VideoEditTimeStretcher.create(request.channels, request.rate)
      pending.catch(() => this.stretchers.delete(clip.id))
      this.stretchers.set(clip.id, pending)
    }
    await mixVideoEditStretchedSound({ ...request, stretcher: await pending!, semitones: clip.pitchSemitones ?? 0, preservePitch: Boolean(clip.preservePitch) })
  }
  /** Bounded one-second mix. Source timestamp alignment also handles VFR video audio. */
  /**
   * 混音（预览与导出同一路径）：有音轨混音或主轨设置时先按轨道分总线（轨道效果、音量、声像），再进主轨（主轨效果、主音量）；
   * 否则片段直接相加。总线效果链有延迟时多混后面的声音抵消，块不连续时从前面预混一段让状态稳定，与片段效果链同一套规则。
   */
  async mixAudio(startSeconds: number, durationSeconds: number, retainIdle = false): Promise<Float32Array[]> {
    const sets: AudioMixSets = { activeAudio: new Set(), activeChains: new Set(), activeStretchers: new Set() }
    const clips = audibleVideoEditClips(this.document)
    const mixer = videoEditAudioMixer(this.document)
    const result = mixer ? await this.mixBuses(startSeconds, durationSeconds, retainIdle, clips, mixer, sets) : await this.mixClips(startSeconds, durationSeconds, retainIdle, clips, sets)
    const { activeAudio, activeChains, activeStretchers } = sets
    // 拖动播放头的声音颗粒（retainIdle）每次落在不同位置、用到不同片段：本次没用到的来源不立即关掉，按最近使用保留至多
    // VIDEO_EDIT_IDLE_AUDIO_SOURCES 个空闲的，否则每个颗粒都要重开解码与声音会话（复杂工程实测一次拖动约 20 次、每次约 100ms，
    // 与节目取帧争用同一个原生解码服务）。连续播放与导出不保留，用完即关。
    const idle = [...this.sources.keys()].filter(key => key.startsWith('audio:') && !activeAudio.has(key)).concat([...this.nestedSounds.keys()].filter(id => !activeAudio.has(id)))
    for (const key of retireIdle(this.idleAudio, idle, retainIdle ? VIDEO_EDIT_IDLE_AUDIO_SOURCES : 0)) {
      const pending = this.sources.get(key)
      if (pending) { this.sources.delete(key); this.release(await pending) }
      const renderer = this.nestedSounds.get(key)
      if (renderer) { this.nestedSounds.delete(key); await renderer.dispose() }
    }
    for (const [id, chain] of this.audioChains) if (!activeChains.has(id) && !this.idleAudio.has(id)) { chain.dispose(); this.audioChains.delete(id) }
    for (const id of this.stretchers.keys()) if (!activeStretchers.has(id)) this.stretchers.delete(id)
    return result
  }

  /** 一条总线（轨道或主轨）的效果链：按键复用，采样率或声道变了重建。 */
  private busChain(key: string, sets: AudioMixSets): AudioEffectChain {
    const rate = this.document.sampleRate
    let chain = this.audioChains.get(key)
    if (!chain || chain.rate !== rate || chain.channels !== this.document.channels) { chain?.dispose(); chain = new AudioEffectChain(rate, this.document.channels); this.audioChains.set(key, chain) }
    sets.activeChains.add(key)
    return chain
  }

  private async mixBuses(startSeconds: number, durationSeconds: number, retainIdle: boolean, clips: readonly VideoEditClip[], mixer: VideoEditAudioMixer, sets: AudioMixSets): Promise<Float32Array[]> {
    const rate = this.document.sampleRate, channels = this.document.channels
    const firstSample = Math.ceil(startSeconds * rate - 1e-7)
    const length = Math.max(1, Math.ceil((startSeconds + durationSeconds) * rate - 1e-7) - firstSample)
    // 主轨：有效果时按效果链延迟与连续性决定要混哪一段
    let master = { inputStart: firstSample, inputLength: length, discard: 0 }
    let masterChain: AudioEffectChain | undefined
    if (mixer.master.effects.length) {
      masterChain = this.busChain('master', sets)
      const rebuilt = await masterChain.sync(mixer.master.effects)
      const plan = planAudioEffectBlock(masterChain, firstSample, length)
      if (!plan.contiguous && !rebuilt) await masterChain.reset(mixer.master.effects)
      master = plan
    }
    const masterInput = Array.from({ length: channels }, () => new Float32Array(master.inputLength))
    const byTrack = new Map<number, VideoEditClip[]>()
    for (const clip of clips) byTrack.set(clip.track, [...(byTrack.get(clip.track) ?? []), clip])
    for (const [index, trackClips] of byTrack) {
      const bus = mixer.tracks.get(index)
      let plan = { inputStart: master.inputStart, inputLength: master.inputLength, discard: 0 }
      let chain: AudioEffectChain | undefined
      if (bus?.effects.length) {
        chain = this.busChain(bus.key, sets)
        const rebuilt = await chain.sync(bus.effects)
        const planned = planAudioEffectBlock(chain, master.inputStart, master.inputLength)
        if (!planned.contiguous && !rebuilt) await chain.reset(bus.effects)
        plan = planned
      }
      const mixed = await this.mixClips(plan.inputStart / rate, plan.inputLength / rate, retainIdle, trackClips, sets)
      if (chain) { chain.process(mixed, plan.inputLength); chain.nextSample = master.inputStart + master.inputLength }
      const pan = videoEditPanGains(bus?.pan ?? 0, channels), gain = bus?.gain ?? 1
      for (let channel = 0; channel < channels; channel++) {
        const factor = gain * pan[channel]
        if (!factor) continue
        const source = mixed[channel], target = masterInput[channel]
        for (let sample = 0; sample < master.inputLength; sample++) target[sample] += source[plan.discard + sample] * factor
      }
    }
    if (masterChain) { masterChain.process(masterInput, master.inputLength); masterChain.nextSample = firstSample + length }
    return masterInput.map(data => {
      const output = data.slice(master.discard, master.discard + length)
      if (mixer.master.gain !== 1) for (let sample = 0; sample < output.length; sample++) output[sample] *= mixer.master.gain
      return output
    })
  }

  private async mixClips(startSeconds: number, durationSeconds: number, retainIdle: boolean, clips: readonly VideoEditClip[], sets: AudioMixSets): Promise<Float32Array[]> {
    const rate = this.document.sampleRate
    const firstSample = Math.ceil(startSeconds * rate - 1e-7)
    const length = Math.max(1, Math.ceil((startSeconds + durationSeconds) * rate - 1e-7) - firstSample)
    const sampleStartSeconds = firstSample / rate
    const result = Array.from({ length: this.document.channels }, () => new Float32Array(length))
    const finish = startSeconds + durationSeconds
    const { activeAudio, activeChains, activeStretchers } = sets
    const fps = this.document.fps
    // 音频过渡（PR 恒定功率／恒定增益）：左片段越过出点、右片段提前入点，在窗口里按曲线交叉淡化。
    const audioWindows = (this.document.transitions ?? []).filter(transition => videoEditTransitionMedium(transition.kind) === 'audio').flatMap((transition): VideoEditTransitionWindow[] => { try { return [videoEditTransitionWindow(this.document, transition)] } catch { return [] } })
    for (const clip of clips) {
      const outgoing = audioWindows.filter(window => window.left.id === clip.id && window.side !== 'in'); const incoming = audioWindows.filter(window => window.right.id === clip.id && window.side !== 'out')
      const sourceGain = videoEditGainMultiplier(clip.gainDb)
      const clipStart = clip.start / fps
      const playStart = Math.min(clip.start, ...incoming.map(window => window.start)) / fps
      const playEnd = Math.max(clip.start + clip.duration, ...outgoing.map(window => window.end)) / fps
      let from = Math.max(startSeconds, playStart)
      const to = Math.min(finish, playEnd)
      const media = videoEditClipMedia(this.document, clip)
      const nested = videoEditNestedComposition(this.document, clip)
      if (!media && !nested) continue
      const sourceDuration = nested ? videoEditDuration(nested) / nested.fps : media!.durationSeconds
      // 源素材开头之前（倒放时为结尾之后）没有声音：入点前余量不足的部分静音，余量按片段速度换算（clipSpeed.ts）。
      const headRoom = clipStart - videoEditClipHeadRoomSeconds(clip, sourceDuration)
      from = Math.max(from, headRoom)
      if (from >= to) continue
      const audioMode = videoEditClipAudioMode(clip)
      // 淡化手柄与音频过渡的增益包络（按输出采样）；没有时整段就是片段音量。
      const enveloped = videoEditClipFades(clip) || outgoing.length > 0 || incoming.length > 0 || Boolean(clip.curves?.volume?.length)
      const envelope = enveloped ? Float32Array.from({ length }, (_, sample) => {
        const seconds = sampleStartSeconds + sample / rate
        let gain = sourceGain * videoEditClipValue(clip, 'volume', seconds * fps) * (seconds >= clipStart && seconds < (clip.start + clip.duration) / fps ? videoEditFadeGain(clip, seconds, fps) : 1)
        for (const window of [...outgoing, ...incoming]) {
          const begin = window.start / fps; const end = window.end / fps
          if (seconds >= begin && seconds < end) gain *= videoEditAudioTransitionClipGain(window, clip.id, (seconds - begin) / (end - begin))
        }
        return gain
      }) : undefined
      // 把片段声音（各声道映射后）按 gainAt 增益加到 targets：targets 的第 0 个样本是序列样本 base，只写 [from, to) 秒内的样本。
      const readSound = async (from: number, to: number, base: number, targets: Float32Array[], gainAt: (sample: number) => number): Promise<void> => {
      const length = targets[0].length
      if (nested) {
        if (this.sequencePath.includes(nested.id) || this.sequencePath.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('嵌套声音存在循环或超过可混音层数。')
        activeAudio.add(clip.id)
        let renderer = this.nestedSounds.get(clip.id)
        if (!renderer) { renderer = new VideoEditRenderer(nested, this.previewWidth, undefined, 1, this.frames, undefined, [...this.sequencePath, nested.id]); this.nestedSounds.set(clip.id, renderer) }
        const audio = videoEditNestedAudio(nested.sampleRate, sourceDuration, (start, duration) => renderer!.mixAudio(start, duration, retainIdle))
        await this.mixRetimedSound(clip, { clip, fps, rate, channels: this.document.channels, from, to, base, targets, gainAt, reads: [{ audio }] }, audioMode === 'stretch' ? 'stretch' : 'resample', activeStretchers)
        return
      }
      if (audioMode !== 'direct') {
        // 变速／倒放／变调（4.13）：保持音调或变调时经拉伸器（videoEditTimeStretch.ts），否则按位置重采样（videoEditRetimedAudio.ts）。
        const reads = []
        for (const read of clip.audioMapping ? videoEditAudioMixReads(clip.audioMapping, this.document.channels) : [undefined]) {
          const key = read ? `audio:${clip.id}${AUDIO_STREAM_KEY}${read.stream}` : `audio:${clip.id}`
          activeAudio.add(key)
          const source = await this.source(key, media!, read?.stream)
          if (source.audio) reads.push({ audio: source.audio, ...(read ? { gains: read.gains } : {}) })
        }
        await this.mixRetimedSound(clip, { clip, fps, rate, channels: this.document.channels, from, to, base, targets, gainAt, reads }, audioMode, activeStretchers)
        return
      }
      const sampleStartSeconds = base / rate
      const sourceStart = videoEditClipSourceSecondsAtTime(clip, from, fps)
      const sourceEnd = sourceStart + to - from
      // A clip with a channel mapping (task 2.6) reads every sound stream it names, each with its own reader; a clip
      // without one reads the file's first stream with its own channels.
      for (const read of clip.audioMapping ? videoEditAudioMixReads(clip.audioMapping, this.document.channels) : [undefined]) {
      const key = read ? `audio:${clip.id}${AUDIO_STREAM_KEY}${read.stream}` : `audio:${clip.id}`
      activeAudio.add(key)
      const source = await this.source(key, media!, read?.stream)
      if (!source.audio) continue
      for await (const wrapped of source.audio.chunks(sourceStart, sourceEnd, rate)) {
        try {
        // A block already at the sequence rate is read by nearest sample; block edges move by the same half sample so
        // every output sample belongs to exactly one block (any other rate keeps linear interpolation).
        const aligned = wrapped.sampleRate === rate
        const edge = aligned ? NEAREST_SAMPLE_EDGE : 1e-7
        const outputStart = Math.max(0, Math.ceil((from - sampleStartSeconds) * rate - 1e-7), Math.ceil((from + wrapped.timestamp - sourceStart - sampleStartSeconds) * rate - edge))
        const outputEnd = Math.min(length, Math.ceil((to - sampleStartSeconds) * rate - 1e-7), Math.ceil((from + wrapped.timestamp + wrapped.duration - sourceStart - sampleStartSeconds) * rate - edge))
        const gains = read ? read.gains : videoEditDefaultAudioGains(wrapped.numberOfChannels, this.document.channels)
        const planes = new Map<number, Float32Array>()
        const plane = (index: number): Float32Array => {
          let values = planes.get(index)
          if (!values) { values = new Float32Array(wrapped.numberOfFrames); wrapped.copyTo(values, { planeIndex: index, format: 'f32-planar' }); planes.set(index, values) }
          return values
        }
        for (let channel = 0; channel < this.document.channels; channel++) {
          const data = new Float32Array(wrapped.numberOfFrames)
          const row = gains[channel]
          // A source channel past the block's channels (a mapping naming a missing channel) is silence.
          for (let inputChannel = 0; inputChannel < Math.min(row.length, wrapped.numberOfChannels); inputChannel++) {
            const gain = row[inputChannel]
            if (!gain) continue
            const values = plane(inputChannel)
            for (let sample = 0; sample < data.length; sample++) data[sample] += values[sample] * gain
          }
          const output = targets[channel]
          for (let sample = outputStart; sample < outputEnd; sample++) {
            const sourceTime = sampleStartSeconds + sample / rate - from + sourceStart - wrapped.timestamp
            const position = sourceTime * wrapped.sampleRate
            if (aligned) {
              const nearest = Math.floor(position + NEAREST_SAMPLE_EDGE)
              if (nearest >= 0 && nearest < data.length) output[sample] += data[nearest] * gainAt(sample)
              continue
            }
            const left = Math.floor(position); const alpha = position - left
            if (left >= 0 && left < data.length) output[sample] += (data[left] * (1 - alpha) + data[Math.min(left + 1, data.length - 1)] * alpha) * gainAt(sample)
          }
        }
        } finally { wrapped.close() }
      }
      }
      }
      const effects = activeVideoEditAudioEffects(clip)
      if (!effects.length) { await readSound(from, to, firstSample, result, sample => envelope ? envelope[sample] : sourceGain * videoEditClipValue(clip, 'volume', from * fps)); continue }
      // 音频效果（4.7c）：片段音量在效果之前（限幅器的上限不被音量推高），淡化与过渡在效果之后；效果链有延迟时多读后面的素材抵消，
      // 块不连续时从前面预读一段让状态稳定。预览与导出都走这里，连续播放时与分块方式无关、逐样本一致。
      let chain = this.audioChains.get(clip.id)
      if (!chain || chain.rate !== rate || chain.channels !== this.document.channels) { chain?.dispose(); chain = new AudioEffectChain(rate, this.document.channels); this.audioChains.set(clip.id, chain) }
      activeChains.add(clip.id)
      const rebuilt = await chain.sync(effects)
      const plan = planAudioEffectBlock(chain, firstSample, length)
      if (!plan.contiguous && !rebuilt) await chain.reset(effects)
      const input = Array.from({ length: this.document.channels }, () => new Float32Array(plan.inputLength))
      const readFrom = Math.max(plan.inputStart / rate, playStart, headRoom); const readTo = Math.min((plan.inputStart + plan.inputLength) / rate, playEnd)
      if (readFrom < readTo) await readSound(readFrom, readTo, plan.inputStart, input, sample => sourceGain * videoEditClipValue(clip, 'volume', (plan.inputStart + sample) / rate * fps))
      const animatedEffects = effects.some(effect => Object.values(effect.builtin.curves ?? {}).some(points => points.length))
      const automated = animatedEffects ? effects.map(effect => ({ ...effect, builtin: { ...effect.builtin, params: evaluateVideoEditBuiltinParameters(effect.builtin, 0) } })) : undefined
      chain.process(input, plan.inputLength, automated ? sample => {
        const time = (plan.inputStart + sample) / rate * fps - clip.start
        effects.forEach((effect, index) => evaluateVideoEditBuiltinParameters(effect.builtin, time, automated[index].builtin.params))
        return automated
      } : undefined)
      chain.nextSample = firstSample + length
      const outputStart = Math.max(0, Math.ceil((from - sampleStartSeconds) * rate - 1e-7)); const outputEnd = Math.min(length, Math.ceil((to - sampleStartSeconds) * rate - 1e-7))
      for (let sample = outputStart; sample < outputEnd; sample++) {
        let shape = 1
        if (enveloped) {
          const seconds = sampleStartSeconds + sample / rate
          if (seconds >= clipStart && seconds < (clip.start + clip.duration) / fps) shape = videoEditFadeGain(clip, seconds, fps)
          for (const window of [...outgoing, ...incoming]) {
            const begin = window.start / fps; const end = window.end / fps
            if (seconds >= begin && seconds < end) shape *= videoEditAudioTransitionClipGain(window, clip.id, (seconds - begin) / (end - begin))
          }
        }
        for (let channel = 0; channel < result.length; channel++) result[channel][sample] += input[channel][plan.discard + sample] * shape
      }
    }
    return result
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.allSettled([...this.nestedPictures.values()].map(entry => entry.renderer.dispose()))
    await Promise.allSettled([...this.nestedSounds.values()].map(renderer => renderer.dispose()))
    this.nestedPictures.clear(); this.nestedSounds.clear()
    await this.disposeCodeInputs()
    await this.disposeCodeInputs(new Set(), this.filterInputs)
    this.cancelPresentation(); await Promise.allSettled([this.codeSources?.dispose(), this.disposePlayback()])
    await Promise.allSettled([...this.seekers.values()].map(seeker => seeker.dispose())); this.seekers.clear(); this.frameCache.clear()
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source) }))
    for (const key of this.images.keys()) this.releaseImage(key)
    this.contentAudio.clear(); this.sources.clear(); this.images.clear(); await this.compositor?.dispose(); this.canvas.width = 1; this.canvas.height = 1
    for (const chain of this.audioChains.values()) chain.dispose()
    this.audioChains.clear(); this.stretchers.clear()
    for (const picture of this.blendedPictures.values()) picture.close()
    this.blendedPictures.clear()
  }
}
