import { videoEditClipMedia, activeVideoEditClips, audibleVideoEditClips, clipSourceSeconds, videoEditVisibleTracks, type VideoEditClip, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditPictureSeconds, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditCaptionClips } from '@/core/videoEdit/timedContent'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'
import type { VideoEditClipAudio, VideoEditClipFrames, VideoEditDecodedPicture, VideoEditFrameBackend, VideoEditFrameSeeker, VideoEditFrameSource } from './videoEditFrameSource'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'
import { videoEditTransitionsAt } from '@/core/videoEdit/transitions'
import { activeVideoEditEffects, buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import { videoEditAudioMixReads, videoEditDefaultAudioGains } from '@/core/videoEdit/audioChannels'
import { readVideoEditExportPicture } from './videoEditExportPictures'

interface PlaybackStream {
  demux: string
  entries: Array<{ frame: number; clipId: string }>
  cursor: number
  samples: AsyncGenerator<VideoEditDecodedPicture | null, void, unknown>
  /** The first pull is started at build time so every scheduled decoder is created before mid-playback cuts. */
  primed?: Promise<IteratorResult<VideoEditDecodedPicture | null, void>>
  /** Serializes pulls; one file never serves two clips at the same frame. */
  tail: Promise<unknown>
}
interface PlaybackSchedule { document: VideoEditComposition; endFrame: number; streams: PlaybackStream[]; byClip: Map<string, PlaybackStream> }
/**
 * Rounding edge of nearest-sample reads: half a sample plus a margin far above floating-point noise, so a clip whose
 * phase lies exactly half-way between two samples picks the same neighbour in every mix block.
 */
const NEAREST_SAMPLE_EDGE = 0.5 + 1e-6
/** Separates a clip id from the sound stream number in a mapped clip's sound source key (`audio:<clip>\0<stream>`). */
const AUDIO_STREAM_KEY = '\u0000'
/** Files decoded through one long-lived decoder each during forward playback. */
const PLAYBACK_SCHEDULE_FILES = 4
// Sequences are at most 30 minutes; one schedule covers the rest of it, since a rebuild means new decoders.
const PLAYBACK_SCHEDULE_SECONDS = 1800
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
  private readonly sources = new Map<string, Promise<VideoSource>>()
  private playback?: PlaybackSchedule
  private lastForwardFrame?: number
  private readonly images = new Map<string, { path: string; controller: AbortController; pending: Promise<ImageBitmap>; bytes: number; ready: boolean }>()
  private imageLoads = 0
  private readonly imageQueue: Array<() => void> = []
  private disposed = false
  private readonly frameCache: VideoEditFrameCache
  private readonly seekers = new Map<string, VideoEditFrameSeeker>()
  readonly canvas: OffscreenCanvas
  private compositor?: VideoEditGpuCompositor
  private codeSources?: VideoEditCodeSources
  private presentationEpoch = 0
  /** High-precision composition counters and, with `row`, that row of the last high-precision frame before 8-bit quantization (task 2.7 acceptance). */
  async precisionDiagnostics(row?: number): Promise<{ counters?: ReturnType<VideoEditGpuCompositor['precisionDiagnostics']>; row?: Uint16Array }> {
    return { counters: this.compositor?.precisionDiagnostics(), row: row === undefined ? undefined : await this.compositor?.readPreciseRow(row) }
  }
  codeDiagnostics() { return { sources: this.codeSources?.diagnostics(), gpu: this.compositor?.codeDiagnostics(), images: this.compositor?.imageDiagnostics(), decodedImages: this.images.size, decodedImageBytes: [...this.images.values()].reduce((sum, entry) => sum + entry.bytes, 0), imageDecodes: this.imageLoads } }
  /** `frames` is the only decoding dependency; the renderer never touches a decoder implementation. */
  constructor(public document: VideoEditComposition, private readonly previewWidth?: number, surface?: OffscreenCanvas, cacheBudgetBytes = 8 * 1024 ** 3, private readonly frames: VideoEditFrameBackend = new VideoEditBrowserFrames()) {
    if (!Number.isSafeInteger(cacheBudgetBytes) || cacheBudgetBytes < 1 || cacheBudgetBytes > 8 * 1024 ** 3) throw new Error('预览缓存预算无效。')
    this.frameCache = new VideoEditFrameCache(cacheBudgetBytes)
    this.canvas = surface ?? new OffscreenCanvas(document.width, document.height)
    this.canvas.width = document.width; this.canvas.height = document.height
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
  private image(media: VideoEditMedia): Promise<ImageBitmap> {
    let image = this.images.get(media.id)
    if (!image) {
      const controller = new AbortController()
      const native = this.boundedImageLoad(controller.signal, async () => {
        const response = await fetch(media.path, { signal: controller.signal }); if (!response.ok) throw videoEditSourceReadError(media.name, new Error(String(response.status)))
        return createImageBitmap(await response.blob())
      }).then(bitmap => {
        if (this.disposed || controller.signal.aborted || this.images.get(media.id)?.pending !== pending) { bitmap.close(); throw new DOMException('原图片已取消。', 'AbortError') }
        if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 8192 || bitmap.height > 8192) { bitmap.close(); throw new Error('图片边长须在1到8192像素之间。') }
        const bytes = bitmap.width * bitmap.height * 4
        const others = [...this.images].reduce((sum, [id, image]) => sum + (id === media.id ? 0 : image.bytes), 0)
        if (others + bytes > 256 * 1024 ** 2) { bitmap.close(); throw new Error('解码图片超过256MiB预算，请减少同时显示的图片。') }
        const entry = this.images.get(media.id)!; entry.bytes = bytes; entry.ready = true
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
  async updateDocument(document: VideoEditComposition): Promise<void> {
    if (document.id !== this.document.id) throw new Error('渲染目标工程已经改变。')
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
    if (this.canvas.width !== document.width || this.canvas.height !== document.height) { this.canvas.width = document.width; this.canvas.height = document.height }
  }
  cancelPresentation(): void {
    this.presentationEpoch++; this.codeSources?.cancel(); this.compositor?.cancelPresentation()
    for (const [id, image] of this.images) if (!image.ready) this.releaseImage(id)
  }
  /**
   * Forward playback reads every frame of a file through one `samplesAtTimestamps` decoder: a cut back into the
   * same file flushes and re-seeks that decoder instead of allocating a new hardware decoder mid-playback
   * (a new D3D11 decoder blocks the GPU main thread for tens of milliseconds while it creates picture buffers).
   */
  private buildPlayback(document: VideoEditComposition, frame: number, visible: Set<number>): void {
    const endFrame = frame + Math.ceil(document.fps * PLAYBACK_SCHEDULE_SECONDS)
    const groups = new Map<string, { media: VideoEditMedia; clips: VideoEditClip[] }>()
    for (const clip of document.clips) {
      if (clip.kind !== 'video' || !visible.has(clip.track) || clip.start + clip.duration <= frame || clip.start >= endFrame) continue
      const media = videoEditClipMedia(document, clip)
      if (!media || media.kind !== 'video') continue
      const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
      const group = groups.get(key) ?? { media, clips: [] }; group.clips.push(clip); groups.set(key, group)
    }
    const streams: PlaybackStream[] = []; const byClip = new Map<string, PlaybackStream>()
    const ordered = [...groups.values()].map(group => ({ ...group, clips: group.clips.sort((a, b) => a.start - b.start) }))
      .filter(group => group.clips.every((clip, index) => index === 0 || group.clips[index - 1].start + group.clips[index - 1].duration <= clip.start))
      .sort((a, b) => a.clips[0].start - b.clips[0].start).slice(0, PLAYBACK_SCHEDULE_FILES)
    for (const group of ordered) {
      const entries: PlaybackStream['entries'] = []; const timestamps: number[] = []
      for (const clip of group.clips) for (let at = Math.max(frame, clip.start); at < Math.min(endFrame, clip.start + clip.duration); at++) {
        entries.push({ frame: at, clipId: clip.id }); timestamps.push(videoEditPictureSeconds(clipSourceSeconds(clip, at, document.fps)))
      }
      const demux = this.frames.open(group.media)
      const samples = (async function* (ready: Promise<VideoEditFrameSource>) { yield* (await ready).schedule(timestamps) })(demux.ready)
      const primed = samples.next(); primed.catch(() => undefined)
      const stream: PlaybackStream = { demux: demux.key, entries, cursor: 0, samples, primed, tail: Promise.resolve() }
      streams.push(stream); for (const clip of group.clips) byClip.set(clip.id, stream)
    }
    this.playback = { document, endFrame, streams, byClip }
  }
  private async disposePlayback(): Promise<void> {
    const playback = this.playback; this.playback = undefined
    if (!playback) return
    await Promise.allSettled(playback.streams.map(async stream => {
      await stream.tail.catch(() => undefined)
      const primed = stream.primed; stream.primed = undefined
      if (primed) (await primed.catch(() => undefined))?.value?.close()
      await stream.samples.return(); this.release(stream)
    }))
  }
  /** The scheduled picture for exactly this frame and clip, or undefined to use the regular path. */
  private takeScheduled(stream: PlaybackStream, frame: number, clipId: string): Promise<VideoEditDecodedPicture | undefined> {
    const pull = (): Promise<IteratorResult<VideoEditDecodedPicture | null, void>> => { const primed = stream.primed; stream.primed = undefined; return primed ?? stream.samples.next() }
    const next = stream.tail.catch(() => undefined).then(async () => {
      while (stream.cursor < stream.entries.length && stream.entries[stream.cursor].frame < frame) {
        stream.cursor++; const skipped = await pull(); skipped.value?.close()
      }
      const entry = stream.entries[stream.cursor]
      if (!entry || entry.frame !== frame || entry.clipId !== clipId) return undefined
      stream.cursor++
      const result = await pull()
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
  /**
   * `blankPictures` counts video layers with no picture at their source time (drawn transparent, no timestamp).
   * A sequential render without a preview width is an export frame (task 2.4): every video layer shows the exact
   * picture at its source time or the frame fails (`videoEditExportPictures.ts`); `singleFrameReads` counts the layers
   * a single-frame read decided because the sequential reader's picture was not exact.
   */
  async render(frame: number, sequential = false, _scrubbing = false, shouldPresent: () => boolean = () => true, deadline?: number): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; blankPictures: number; singleFrameReads: number; cacheHits: number; cacheBytes: number; presented: boolean; decodeMs: number; gpuMs: number; completion: Promise<void> }> {
    if (this.disposed) throw new Error('预览已关闭。')
    const document = this.document; const epoch = this.presentationEpoch
    const canPresent = (): boolean => !this.disposed && this.document === document && this.presentationEpoch === epoch && shouldPresent()
    const visible = videoEditVisibleTracks(document)
    if (this.previewWidth && sequential) {
      const forward = this.lastForwardFrame === frame - 1
      if (this.playback && (this.playback.document !== document || frame >= this.playback.endFrame || !forward)) await this.disposePlayback()
      // Only a confirmed forward run builds schedules; reverse play and single steps keep the seek path.
      if (!this.playback && forward) this.buildPlayback(document, frame, visible)
      this.lastForwardFrame = frame
    } else { this.lastForwardFrame = undefined; if (this.playback) await this.disposePlayback() }
    const transitions = videoEditTransitionsAt(document, frame).filter(window => visible.has(window.left.track))
    const active = activeVideoEditClips(document, frame).filter(clip => clip.kind !== 'audio' && (!['code', 'graphic'].includes(clip.kind) || clip.opacity > 0 || activeVideoEditEffects(clip).length))
    const ids = new Set(active.map(clip => clip.id))
    for (const window of transitions) for (const clip of [window.left, window.right]) if (!ids.has(clip.id)) { active.push(clip); ids.add(clip.id) }
    active.push(...videoEditCaptionClips(document, frame))
    const composite = transitions.length || active.some(clip => clip.kind === 'adjustment' || activeVideoEditEffects(clip).length) ? buildVideoEditCompositePlan(active, transitions) : undefined
    const timestamps: number[] = []
    this.compositor ??= new VideoEditGpuCompositor(this.canvas)
    const decodeStart = performance.now()
    if (composite || active.some(clip => ['code', 'graphic'].includes(clip.kind) || activeVideoEditEffects(clip).length)) this.codeSources ??= new VideoEditCodeSources(document, () => this.compositor!.code())
    const imageIds = new Set(active.flatMap(clip => [...codeMaterialImageIds(clip.code), ...activeVideoEditEffects(clip).flatMap(effect => [...codeMaterialImageIds(effect.code)]), ...(clip.kind === 'image' ? [videoEditClipMedia(document, clip)?.id ?? ''] : [])]))
    const imageMedia = [...imageIds].map(id => {
      const media = document.media.find(media => media.id === id && media.kind === 'image')
      if (!media) throw new Error('代码图片引用或图片片段的源素材不存在。')
      return media
    })
    if (imageMedia.length > 32 || imageMedia.reduce((sum, media) => sum + media.width * media.height * 4, 0) > 256 * 1024 ** 2) throw new Error('可见图片超过32份或256MiB预算，请减少同时显示的图片。')
    for (const id of this.images.keys()) if (!imageIds.has(id)) this.releaseImage(id)
    const imagesReady = Promise.all(imageMedia.map(async media => [media.id, await this.image(media)] as const)).then(images => this.compositor!.prepareImages(new Map(images), canPresent, new Set(active.filter(clip => clip.kind === 'text').map(clip => clip.id)), new Set(active.map(clip => clip.id))))
    const imagesSettled = Promise.allSettled([imagesReady])
    const codeReady = this.codeSources?.prepare(document, active, frame, canPresent, imagesReady, { transitions, surfaceKeys: composite ? videoEditCompositeSurfaceKeys(composite) : undefined })
    const codeSettled = codeReady ? Promise.allSettled([codeReady]) : Promise.resolve([])
    this.frameCache.setHotFrames(active.flatMap(clip => {
      const media = videoEditClipMedia(document, clip)
      return clip.kind === 'video' && media ? [{ mediaId: media.path, time: videoEditPictureSeconds(clipSourceSeconds(clip, frame, document.fps)) }] : []
    }))
    // A cut opens a new demuxer/decoder; doing that on the boundary frame stalls playback.
    // Open and decode the first picture of clips starting within half a second ahead of time.
    const upcoming = sequential && this.previewWidth ? this.upcomingVideoClips(document, frame, visible) : []
    for (const clip of upcoming) this.preroll(clip, document)
    let cacheHits = 0
    let blankPictures = 0
    let singleFrameReads = 0
    const picturesPending = active.map(async clip => {
      const media = videoEditClipMedia(document, clip)
      if (clip.kind === 'text' || clip.kind === 'adjustment') return null
      if (clip.kind === 'code' || clip.kind === 'graphic') {
        const picture = (await codeReady)?.pictures.get(clip.id)
        if (!picture) throw new Error(`代码素材 ${clip.name} 没有返回画面。`)
        return picture
      }
      if (!media) throw new Error(`找不到素材 ${clip.name}`)
      if (media.kind === 'image') return this.image(media)
      const originalTime = clipSourceSeconds(clip, frame, document.fps)
      // Every picture lookup (schedule, seek, export read) uses the same picture time: the source time plus the container
      // timestamp rounding tolerance (task 3.2, D3), so a picture a container rounded up still shows at its own frame.
      const time = videoEditPictureSeconds(originalTime)
      const pendingSource = this.source(clip.id, media)
      const source = await pendingSource
      // Never race a pre-roll on the shared iterator: it would hand this frame the second picture.
      await source.prerolled
      if (!source.video) throw new Error(`素材 ${media.name} 没有可解码的视频轨。`)
      const scheduledStream = sequential && this.previewWidth ? this.playback?.byClip.get(clip.id) : undefined
      const scheduled = scheduledStream ? await this.takeScheduled(scheduledStream, frame, clip.id) : undefined
      // A sequential reader started before the stream's first picture hands out that first picture early: it is kept
      // for its own time and nothing shows until then.
      let early = false
      // A backwards source clock must use the shared GOP cache even when the
      // caller requests continuous playback; a forward iterator would re-decode
      // the whole GOP for every preceding picture.
      if (scheduled) {
        await source.iterator?.return(); source.iterator = undefined
        source.current?.close(); source.current = scheduled
      } else if (this.previewWidth && (!sequential || time < source.previousTime)) {
        await source.iterator?.return(); source.iterator = undefined
        let seeker = this.seekers.get(media.path)
        if (!seeker) { seeker = this.frames.seeker(media, this.frameCache, (sample, compact) => this.compositor!.snapshot(sample, compact)); this.seekers.set(media.path, seeker) }
        const direction = source.previousTime < 0 || Math.abs(time - source.previousTime) > 1 ? 0 : Math.sign(time - source.previousTime)
        const result = await seeker.sample(time, direction)
        if (result.hit) cacheHits++
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
      return source.current
    })
    const settled = await Promise.allSettled(picturesPending)
    const imageResults = await imagesSettled
    const preparedCode = await codeSettled
    if (!canPresent()) return { canvas: this.canvas, sourceTimestamps: [], blankPictures, singleFrameReads, cacheHits, cacheBytes: this.frameCache.bytes, presented: false, decodeMs: performance.now() - decodeStart, gpuMs: 0, completion: Promise.resolve() }
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
    try {
      result = composite ? await renderVideoEditCompositeScene(document, composite, new Map(active.map((clip, index) => [clip.id, pictures[index]])), preparedCode[0]?.status === 'fulfilled' ? preparedCode[0].value.effects : new Map(), this.compositor, frame, canPresent, deadline) : await this.compositor.draw(document, active, pictures, canPresent, deadline)
    } catch (error) {
      if (canPresent()) throw error
      result = { presented: false, completion: Promise.resolve() }
    }
    const { presented, completion } = result
    const gpuMs = performance.now() - gpuStart
    const activeIds = new Set(canPresent() ? [...active, ...upcoming].map(clip => clip.id) : [...this.sources.keys()].filter(key => !key.startsWith('audio:')))
    for (const [key, pending] of this.sources) if (!activeIds.has(key) && !key.startsWith('audio:')) {
      this.sources.delete(key); const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source)
    }
    const activeImages = new Set(canPresent() ? imageIds : this.images.keys())
    for (const key of this.images.keys()) if (!activeImages.has(key)) this.releaseImage(key)
    const activePaths = new Set(canPresent() ? active.map(clip => videoEditClipMedia(document, clip)?.path) : this.seekers.keys())
    for (const [path, seeker] of this.seekers) if (!activePaths.has(path)) { this.seekers.delete(path); await seeker.dispose() }
    return { canvas: this.canvas, sourceTimestamps: timestamps, blankPictures, singleFrameReads, cacheHits, cacheBytes: this.frameCache.bytes, presented, decodeMs, gpuMs, completion }
  }
  /** Bounded one-second mix. Source timestamp alignment also handles VFR video audio. */
  async mixAudio(startSeconds: number, durationSeconds: number): Promise<Float32Array[]> {
    const rate = this.document.sampleRate
    const firstSample = Math.ceil(startSeconds * rate - 1e-7)
    const length = Math.max(1, Math.ceil((startSeconds + durationSeconds) * rate - 1e-7) - firstSample)
    const sampleStartSeconds = firstSample / rate
    const result = Array.from({ length: this.document.channels }, () => new Float32Array(length))
    const finish = startSeconds + durationSeconds
    const activeAudio = new Set<string>()
    for (const clip of audibleVideoEditClips(this.document)) {
      const clipStart = clip.start / this.document.fps
      const from = Math.max(startSeconds, clipStart)
      const to = Math.min(finish, (clip.start + clip.duration) / this.document.fps)
      if (from >= to) continue
      const media = videoEditClipMedia(this.document, clip)
      if (!media) continue
      const sourceStart = videoEditSourceSeconds(clip) + from - clipStart
      const sourceEnd = sourceStart + to - from
      // A clip with a channel mapping (task 2.6) reads every sound stream it names, each with its own reader; a clip
      // without one reads the file's first stream with its own channels.
      for (const read of clip.audioMapping ? videoEditAudioMixReads(clip.audioMapping, this.document.channels) : [undefined]) {
      const key = read ? `audio:${clip.id}${AUDIO_STREAM_KEY}${read.stream}` : `audio:${clip.id}`
      activeAudio.add(key)
      const source = await this.source(key, media, read?.stream)
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
          const output = result[channel]
          for (let sample = outputStart; sample < outputEnd; sample++) {
            const sourceTime = sampleStartSeconds + sample / rate - from + sourceStart - wrapped.timestamp
            const position = sourceTime * wrapped.sampleRate
            if (aligned) {
              const nearest = Math.floor(position + NEAREST_SAMPLE_EDGE)
              if (nearest >= 0 && nearest < data.length) output[sample] += data[nearest] * clip.volume
              continue
            }
            const left = Math.floor(position); const alpha = position - left
            if (left >= 0 && left < data.length) output[sample] += (data[left] * (1 - alpha) + data[Math.min(left + 1, data.length - 1)] * alpha) * clip.volume
          }
        }
        } finally { wrapped.close() }
      }
      }
    }
    for (const [key, pending] of this.sources) if (key.startsWith('audio:') && !activeAudio.has(key)) {
      this.sources.delete(key); this.release(await pending)
    }
    return result
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancelPresentation(); await Promise.allSettled([this.codeSources?.dispose(), this.disposePlayback()])
    await Promise.allSettled([...this.seekers.values()].map(seeker => seeker.dispose())); this.seekers.clear(); this.frameCache.clear()
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); this.release(source) }))
    for (const key of this.images.keys()) this.releaseImage(key)
    this.sources.clear(); this.images.clear(); await this.compositor?.dispose(); this.canvas.width = 1; this.canvas.height = 1
  }
}
