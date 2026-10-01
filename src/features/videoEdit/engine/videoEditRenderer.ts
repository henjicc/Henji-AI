import { ALL_FORMATS, AudioSampleSink, VideoSampleSink, VideoSample, Input, UrlSource } from 'mediabunny'
import { videoEditClipMedia, activeVideoEditClips, audibleVideoEditClips, clipSourceSeconds, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditSeekDecoder } from './videoEditSeekDecoder'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'

interface VideoSource {
  input: Input
  media: VideoEditMedia
  video?: VideoSampleSink
  audio?: AudioSampleSink
  iterator?: AsyncGenerator<VideoSample, void, unknown>
  current?: VideoSample | VideoEditGpuFrame
  previousTime: number
  codec?: string
}
/** One bounded decoder per visible clip; all inputs close when the view detaches. */
export class VideoEditRenderer {
  private readonly sources = new Map<string, Promise<VideoSource>>()
  private readonly images = new Map<string, { path: string; controller: AbortController; pending: Promise<ImageBitmap>; bytes: number; ready: boolean }>()
  private imageLoads = 0
  private readonly imageQueue: Array<() => void> = []
  private disposed = false
  private readonly frameCache: VideoEditFrameCache
  private readonly seekers = new Map<string, VideoEditSeekDecoder>()
  readonly canvas: OffscreenCanvas
  private compositor?: VideoEditGpuCompositor
  private codeSources?: VideoEditCodeSources
  private presentationEpoch = 0
  codeDiagnostics() { return { sources: this.codeSources?.diagnostics(), gpu: this.compositor?.codeDiagnostics(), images: this.compositor?.imageDiagnostics(), decodedImages: this.images.size, decodedImageBytes: [...this.images.values()].reduce((sum, entry) => sum + entry.bytes, 0), imageDecodes: this.imageLoads } }
  constructor(public document: VideoEditComposition, private readonly previewWidth?: number, surface?: OffscreenCanvas, cacheBudgetBytes = 8 * 1024 ** 3) {
    if (!Number.isSafeInteger(cacheBudgetBytes) || cacheBudgetBytes < 1 || cacheBudgetBytes > 8 * 1024 ** 3) throw new Error('预览缓存预算无效。')
    this.frameCache = new VideoEditFrameCache(cacheBudgetBytes)
    this.canvas = surface ?? new OffscreenCanvas(document.width, document.height)
    this.canvas.width = document.width; this.canvas.height = document.height
  }
  private source(key: string, media: VideoEditMedia): Promise<VideoSource> {
    let source = this.sources.get(key)
    if (!source) {
      source = (async () => {
        const input = new Input({ source: new UrlSource(media.path, { maxCacheSize: 32 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
        try {
          const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
          if (this.disposed) throw new Error('预览已关闭。')
          const config = video ? await video.getDecoderConfig() : null
          const preference = 'prefer-hardware'
          const supported = config && (await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: preference, optimizeForLatency: true })).supported
          const options = { hardwareAcceleration: supported ? preference : 'no-preference', optimizeForLatency: true } as const
          // Sequential playback decodes the original compressed stream.
          return { input, media, video: video ? new VideoSampleSink(video, options) : undefined, audio: audio ? new AudioSampleSink(audio) : undefined, previousTime: -1, codec: config?.codec }
        } catch (error) { input.dispose(); throw error }
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
        const response = await fetch(media.path, { signal: controller.signal }); if (!response.ok) throw new Error(`无法读取素材 ${media.name}`)
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
      const source = await pending
      const clip = document.clips.find(clip => clip.id === (key.startsWith('audio:') ? key.slice(6) : key))
      const media = clip ? videoEditClipMedia(document, clip) : undefined
      if (!media || media.id !== source.media.id || media.path !== source.media.path || media.sourceRevision !== source.media.sourceRevision) {
        this.sources.delete(key); source.current?.close(); await source.iterator?.return(); source.input.dispose()
      }
    }
    this.document = document
    if (this.canvas.width !== document.width || this.canvas.height !== document.height) { this.canvas.width = document.width; this.canvas.height = document.height }
  }
  cancelPresentation(): void {
    this.presentationEpoch++; this.codeSources?.cancel(); this.compositor?.cancelPresentation()
    for (const [id, image] of this.images) if (!image.ready) this.releaseImage(id)
  }
  async render(frame: number, sequential = false, _scrubbing = false, shouldPresent: () => boolean = () => true, deadline?: number): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; cacheHits: number; cacheBytes: number; presented: boolean; decodeMs: number; gpuMs: number; completion: Promise<void> }> {
    if (this.disposed) throw new Error('预览已关闭。')
    const document = this.document; const epoch = this.presentationEpoch
    const canPresent = (): boolean => !this.disposed && this.document === document && this.presentationEpoch === epoch && shouldPresent()
    const active = activeVideoEditClips(document, frame).filter(clip => clip.kind !== 'audio' && (clip.kind !== 'code' || clip.opacity > 0))
    const timestamps: number[] = []
    this.compositor ??= new VideoEditGpuCompositor(this.canvas)
    const decodeStart = performance.now()
    const codeClips = active.filter(clip => clip.kind === 'code')
    if (codeClips.length) this.codeSources ??= new VideoEditCodeSources(document, () => this.compositor!.code())
    const imageIds = new Set(active.flatMap(clip => [...codeMaterialImageIds(clip.code), ...(clip.kind === 'image' ? [videoEditClipMedia(document, clip)?.id ?? ''] : [])]))
    const imageMedia = [...imageIds].map(id => {
      const media = document.media.find(media => media.id === id && media.kind === 'image')
      if (!media) throw new Error('代码图片引用或图片片段的源素材不存在。')
      return media
    })
    if (imageMedia.length > 32 || imageMedia.reduce((sum, media) => sum + media.width * media.height * 4, 0) > 256 * 1024 ** 2) throw new Error('可见图片超过32份或256MiB预算，请减少同时显示的图片。')
    for (const id of this.images.keys()) if (!imageIds.has(id)) this.releaseImage(id)
    const imagesReady = Promise.all(imageMedia.map(async media => [media.id, await this.image(media)] as const)).then(images => this.compositor!.prepareImages(new Map(images), canPresent, new Set(active.filter(clip => clip.kind === 'text').map(clip => clip.id))))
    const imagesSettled = Promise.allSettled([imagesReady])
    const codeReady = this.codeSources?.prepare(document, codeClips, frame, canPresent, imagesReady)
    const codeSettled = codeReady ? Promise.allSettled([codeReady]) : Promise.resolve([])
    this.frameCache.setHotFrames(active.flatMap(clip => {
      const media = videoEditClipMedia(document, clip)
      return clip.kind === 'video' && media ? [{ mediaId: media.path, time: clipSourceSeconds(clip, frame, document.fps) }] : []
    }))
    let cacheHits = 0
    const picturesPending = active.map(async clip => {
      const media = videoEditClipMedia(document, clip)
      if (clip.kind === 'text') return null
      if (clip.kind === 'code') {
        const picture = (await codeReady)?.pictures.get(clip.id)
        if (!picture) throw new Error(`代码素材 ${clip.name} 没有返回画面。`)
        return picture
      }
      if (!media) throw new Error(`找不到素材 ${clip.name}`)
      if (media.kind === 'image') return this.image(media)
      const originalTime = clipSourceSeconds(clip, frame, document.fps)
      const time = originalTime
      const pendingSource = this.source(clip.id, media)
      const source = await pendingSource
      if (!source.video) throw new Error(`素材 ${media.name} 没有可解码的视频轨。`)
      // A backwards source clock must use the shared GOP cache even when the
      // caller requests continuous playback; a forward iterator would re-decode
      // the whole GOP for every preceding picture.
      if (this.previewWidth && (!sequential || time < source.previousTime)) {
        await source.iterator?.return(); source.iterator = undefined
        let seeker = this.seekers.get(media.path)
        if (!seeker) { seeker = new VideoEditSeekDecoder(media.path, this.frameCache, (sample, compact) => this.compositor!.snapshot(sample, compact)); this.seekers.set(media.path, seeker) }
        const direction = source.previousTime < 0 || Math.abs(time - source.previousTime) > 1 ? 0 : Math.sign(time - source.previousTime)
        const result = await seeker.sample(time, direction)
        if (result.hit) cacheHits++
        source.current?.close(); source.current = result.sample
      } else if (sequential || (this.previewWidth && time >= source.previousTime && time - source.previousTime <= 2)) {
        if (!source.iterator || time < source.previousTime || time - source.previousTime > 2) {
          source.current?.close(); await source.iterator?.return(); source.iterator = source.video.samples(time); source.current = undefined
        }
        while (!source.current || source.current.timestamp + source.current.duration <= time + 1e-7) {
          const next = await source.iterator.next(); if (next.done) break
          source.current?.close(); source.current = next.value
        }
      } else {
        source.current?.close(); await source.iterator?.return()
        source.iterator = undefined
        source.current = await source.video.getSample(time) ?? undefined
      }
      source.previousTime = time
      if (!source.current) throw new Error(`素材 ${media.name} 在此时间没有画面。`)
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
    if (!canPresent()) return { canvas: this.canvas, sourceTimestamps: [], cacheHits, cacheBytes: this.frameCache.bytes, presented: false, decodeMs: performance.now() - decodeStart, gpuMs: 0, completion: Promise.resolve() }
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
    const { presented, completion } = await this.compositor.draw(document, active, pictures, canPresent, deadline)
    const gpuMs = performance.now() - gpuStart
    const activeIds = new Set(canPresent() ? active.map(clip => clip.id) : [...this.sources.keys()].filter(key => !key.startsWith('audio:')))
    for (const [key, pending] of this.sources) if (!activeIds.has(key) && !key.startsWith('audio:')) {
      this.sources.delete(key); const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose()
    }
    const activeImages = new Set(canPresent() ? imageIds : this.images.keys())
    for (const key of this.images.keys()) if (!activeImages.has(key)) this.releaseImage(key)
    const activePaths = new Set(canPresent() ? active.map(clip => videoEditClipMedia(document, clip)?.path) : this.seekers.keys())
    for (const [path, seeker] of this.seekers) if (!activePaths.has(path)) { this.seekers.delete(path); await seeker.dispose() }
    return { canvas: this.canvas, sourceTimestamps: timestamps, cacheHits, cacheBytes: this.frameCache.bytes, presented, decodeMs, gpuMs, completion }
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
      activeAudio.add(`audio:${clip.id}`)
      const source = await this.source(`audio:${clip.id}`, media)
      if (!source.audio) continue
      const sourceStart = videoEditSourceSeconds(clip) + from - clipStart
      const sourceEnd = sourceStart + to - from
      for await (const wrapped of source.audio.samples(sourceStart, sourceEnd)) {
        try {
        const outputStart = Math.max(0, Math.ceil((from - sampleStartSeconds) * rate - 1e-7), Math.ceil((from + wrapped.timestamp - sourceStart - sampleStartSeconds) * rate - 1e-7))
        const outputEnd = Math.min(length, Math.ceil((to - sampleStartSeconds) * rate - 1e-7), Math.ceil((from + wrapped.timestamp + wrapped.duration - sourceStart - sampleStartSeconds) * rate - 1e-7))
        for (let channel = 0; channel < this.document.channels; channel++) {
          const data = new Float32Array(wrapped.numberOfFrames)
          const inputChannels = this.document.channels === 1 ? wrapped.numberOfChannels : 1
          for (let inputChannel = 0; inputChannel < inputChannels; inputChannel++) {
            const plane = new Float32Array(wrapped.numberOfFrames)
            wrapped.copyTo(plane, { planeIndex: this.document.channels === 1 ? inputChannel : Math.min(channel, wrapped.numberOfChannels - 1), format: 'f32-planar' })
            for (let sample = 0; sample < data.length; sample++) data[sample] += plane[sample] / inputChannels
          }
          const output = result[channel]
          for (let sample = outputStart; sample < outputEnd; sample++) {
            const sourceTime = sampleStartSeconds + sample / rate - from + sourceStart - wrapped.timestamp
            const position = sourceTime * wrapped.sampleRate
            const left = Math.floor(position); const alpha = position - left
            if (left >= 0 && left < data.length) output[sample] += (data[left] * (1 - alpha) + data[Math.min(left + 1, data.length - 1)] * alpha) * clip.volume
          }
        }
        } finally { wrapped.close() }
      }
    }
    for (const [key, pending] of this.sources) if (key.startsWith('audio:') && !activeAudio.has(key)) {
      this.sources.delete(key); (await pending).input.dispose()
    }
    return result
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancelPresentation(); await Promise.allSettled([this.codeSources?.dispose()])
    await Promise.allSettled([...this.seekers.values()].map(seeker => seeker.dispose())); this.seekers.clear(); this.frameCache.clear()
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose() }))
    for (const key of this.images.keys()) this.releaseImage(key)
    this.sources.clear(); this.images.clear(); await this.compositor?.dispose(); this.canvas.width = 1; this.canvas.height = 1
  }
}
