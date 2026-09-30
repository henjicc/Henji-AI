import { ALL_FORMATS, AudioSampleSink, VideoSampleSink, VideoSample, Input, UrlSource } from 'mediabunny'
import { activeVideoEditClips, clipSourceSeconds, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditFrameCache, type CachedVideoEditFrame } from './videoEditFrameCache'
import type { VideoEditPreviewSource } from '@/core/videoEdit/preview'

interface VideoSource {
  input: Input
  media: VideoEditMedia
  video?: VideoSampleSink
  audio?: AudioSampleSink
  iterator?: AsyncGenerator<VideoSample, void, unknown>
  current?: VideoSample
  previousTime: number
}
/** One bounded decoder per visible clip; all inputs close when the view detaches. */
export class VideoEditRenderer {
  private readonly sources = new Map<string, Promise<VideoSource>>()
  private readonly images = new Map<string, Promise<ImageBitmap>>()
  private readonly previews = new Map<string, VideoEditPreviewSource>()
  private disposed = false
  private readonly cache = new VideoEditFrameCache(384 * 1024 * 1024)
  private readonly cacheCanvas = new OffscreenCanvas(640, 360)
  readonly canvas: OffscreenCanvas
  readonly context: OffscreenCanvasRenderingContext2D
  constructor(public document: VideoEditDocument, private readonly previewWidth?: number) {
    const scale = previewWidth ? Math.min(1, previewWidth / document.width) : 1
    this.canvas = new OffscreenCanvas(Math.round(document.width * scale), Math.round(document.height * scale))
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('无法创建剪辑预览。')
    this.context = context
  }
  private source(key: string, media: VideoEditMedia): Promise<VideoSource> {
    let source = this.sources.get(key)
    if (!source) {
      source = (async () => {
        const input = new Input({ source: new UrlSource(media.path, { maxCacheSize: 8 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
        try {
          const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
          if (this.disposed) throw new Error('预览已关闭。')
          const config = video ? await video.getDecoderConfig() : null
          const preference = 'no-preference'
          const supported = config && (await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: preference, optimizeForLatency: true })).supported
          return { input, media, video: video ? new VideoSampleSink(video, { hardwareAcceleration: supported ? preference : 'no-preference', optimizeForLatency: true }) : undefined, audio: audio ? new AudioSampleSink(audio) : undefined, previousTime: -1 }
        } catch (error) { input.dispose(); throw error }
      })()
      this.sources.set(key, source)
    }
    return source
  }
  private image(media: VideoEditMedia): Promise<ImageBitmap> {
    let image = this.images.get(media.id)
    if (!image) {
      image = fetch(media.path).then(response => { if (!response.ok) throw new Error(`无法读取素材 ${media.name}`); return response.blob() }).then(blob => createImageBitmap(blob)).then(bitmap => { if (this.disposed) { bitmap.close(); throw new Error('预览已关闭。') } return bitmap })
      this.images.set(media.id, image)
    }
    return image
  }
  async setPreviewSources(sources: VideoEditPreviewSource[]): Promise<void> {
    for (const source of sources) this.previews.set(source.clipId, source)
    for (const [key, pending] of this.sources) if (!key.startsWith('audio:')) {
      const source = await pending; const preview = this.previews.get(key)
      if (preview && preview.path !== source.media.path) { this.sources.delete(key); source.current?.close(); await source.iterator?.return(); source.input.dispose() }
    }
  }
  async updateDocument(document: VideoEditDocument): Promise<void> {
    if (document.id !== this.document.id) throw new Error('渲染目标工程已经改变。')
    for (const media of this.document.media) if (!document.media.some(item => item.id === media.id && item.path === media.path)) {
      this.cache.deleteMedia(media.id)
      const image = this.images.get(media.id); if (image) { this.images.delete(media.id); (await image).close() }
    }
    for (const [key, pending] of this.sources) {
      const source = await pending
      if (!document.media.some(item => item.id === source.media.id && (item.path === source.media.path || this.previews.get(key)?.path === source.media.path))) {
        this.sources.delete(key); source.current?.close(); await source.iterator?.return(); source.input.dispose()
      }
    }
    this.document = document
    const scale = this.previewWidth ? Math.min(1, this.previewWidth / document.width) : 1
    const width = Math.round(document.width * scale); const height = Math.round(document.height * scale)
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height }
  }
  private cacheSample(mediaId: string, sample: VideoSample, pinned: ReadonlySet<CachedVideoEditFrame>, offset = 0): void {
    if (!this.previewWidth || this.cache.get(mediaId, sample.timestamp + offset)) return
    const width = Math.min(640, sample.displayWidth)
    const height = Math.max(1, Math.round(width * sample.displayHeight / sample.displayWidth))
    if (this.cacheCanvas.width !== width || this.cacheCanvas.height !== height) { this.cacheCanvas.width = width; this.cacheCanvas.height = height }
    sample.draw(this.cacheCanvas.getContext('2d')!, 0, 0, width, height)
    this.cache.put(mediaId, { bitmap: this.cacheCanvas.transferToImageBitmap(), timestamp: sample.timestamp + offset, duration: sample.duration }, pinned)
  }
  async render(frame: number, sequential = false, scrubbing = false): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; cacheHits: number; cacheBytes: number }> {
    if (this.disposed) throw new Error('预览已关闭。')
    const active = activeVideoEditClips(this.document, frame).filter(clip => clip.kind !== 'audio')
    const timestamps: number[] = []
    const pinned = new Set<CachedVideoEditFrame>()
    let cacheHits = 0
    const pictures = await Promise.all(active.map(async clip => {
      const media = this.document.media.find(item => item.id === clip.mediaId)
      if (clip.kind === 'text') return null
      if (!media) throw new Error(`找不到素材 ${clip.name}`)
      if (media.kind === 'image') return this.image(media)
      const originalTime = clipSourceSeconds(clip, frame, this.document.fps)
      const preview = this.previews.get(clip.id)
      const offset = preview?.startSeconds ?? 0
      const time = originalTime - offset
      const cached = scrubbing ? this.cache.get(media.id, originalTime) : undefined
      if (cached) { pinned.add(cached); timestamps.push(cached.timestamp); cacheHits++; return cached.bitmap }
      const source = await this.source(clip.id, preview ? { ...media, path: preview.path } : media)
      if (!source.video) throw new Error(`素材 ${media.name} 没有可解码的视频轨。`)
      if (sequential || (this.previewWidth && !preview && time >= source.previousTime && time - source.previousTime <= 2)) {
        if (!source.iterator || time < source.previousTime || time - source.previousTime > 2) {
          source.current?.close(); await source.iterator?.return(); source.iterator = source.video.samples(time); source.current = undefined
        }
        while (!source.current || source.current.timestamp + source.current.duration <= time + 1e-7) {
          const next = await source.iterator.next(); if (next.done) break
          source.current?.close(); source.current = next.value
          this.cacheSample(media.id, next.value, pinned, offset)
        }
      } else {
        source.current?.close(); await source.iterator?.return()
        source.iterator = undefined
        if (this.previewWidth && scrubbing && !preview) {
          // A backward cache miss decodes a bounded preceding window once. The
          // following reverse seeks reuse those timestamped frames, not the GOP.
          source.iterator = source.video.samples(Math.max(0, time - 1))
          source.current = undefined
          while (!source.current || source.current.timestamp + source.current.duration <= time + 1e-7) {
            const next = await source.iterator.next(); if (next.done) break
            source.current?.close(); source.current = next.value
            this.cacheSample(media.id, next.value, pinned, offset)
          }
        } else {
          source.current = await source.video.getSample(time) ?? undefined
          if (source.current) this.cacheSample(media.id, source.current, pinned, offset)
        }
      }
      source.previousTime = time
      if (!source.current) throw new Error(`素材 ${media.name} 在此时间没有画面。`)
      timestamps.push(source.current.timestamp + offset)
      return source.current
    }))
    if (this.disposed) throw new Error('预览已关闭。')
    const context = this.context
    context.fillStyle = 'black'; context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    active.forEach((clip, index) => {
      context.save()
      context.globalAlpha = clip.opacity
      context.translate(this.canvas.width * (0.5 + clip.x), this.canvas.height * (0.5 + clip.y))
      context.rotate(clip.rotation * Math.PI / 180); context.scale(clip.scale, clip.scale)
      context.filter = clip.brightness === 1 ? 'none' : `brightness(${clip.brightness})`
      const picture = pictures[index]
      if (picture) {
        const pictureWidth = picture instanceof VideoSample ? picture.displayWidth : picture.width
        const pictureHeight = picture instanceof VideoSample ? picture.displayHeight : picture.height
        const fit = Math.min(this.canvas.width / pictureWidth, this.canvas.height / pictureHeight)
        const width = pictureWidth * fit; const height = pictureHeight * fit
        if (picture instanceof VideoSample) picture.draw(context, -width / 2, -height / 2, width, height)
        else context.drawImage(picture, -width / 2, -height / 2, width, height)
      } else {
        context.fillStyle = 'white'; context.textAlign = 'center'; context.textBaseline = 'middle'
        context.font = `${Math.round(this.canvas.height / 15)}px sans-serif`
        clip.text.split('\n').forEach((line, lineIndex) => context.fillText(line, 0, lineIndex * this.canvas.height / 12))
      }
      context.restore()
    })
    const activeIds = new Set(active.map(clip => clip.id))
    for (const [key, pending] of this.sources) if (!activeIds.has(key) && !key.startsWith('audio:')) {
      this.sources.delete(key); const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose()
    }
    const activeImages = new Set(active.filter(clip => clip.kind === 'image').map(clip => clip.mediaId))
    for (const [key, pending] of this.images) if (!activeImages.has(key)) {
      this.images.delete(key); (await pending).close()
    }
    return { canvas: this.canvas, sourceTimestamps: timestamps, cacheHits, cacheBytes: this.cache.bytes }
  }
  /** Bounded one-second mix. Source timestamp alignment also handles VFR video audio. */
  async mixAudio(startSeconds: number, durationSeconds: number): Promise<Float32Array[]> {
    const rate = 48000
    const length = Math.max(1, Math.round(durationSeconds * rate))
    const result = [new Float32Array(length), new Float32Array(length)]
    const finish = startSeconds + durationSeconds
    const activeAudio = new Set<string>()
    for (const clip of this.document.clips) {
      if (!['audio', 'video'].includes(clip.kind) || clip.volume === 0) continue
      const clipStart = clip.start / this.document.fps
      const from = Math.max(startSeconds, clipStart)
      const to = Math.min(finish, (clip.start + clip.duration) / this.document.fps)
      if (from >= to) continue
      const media = this.document.media.find(item => item.id === clip.mediaId)
      if (!media) continue
      activeAudio.add(`audio:${clip.id}`)
      const source = await this.source(`audio:${clip.id}`, media)
      if (!source.audio) continue
      const sourceStart = clip.sourceInUs / 1e6 + from - clipStart
      const sourceEnd = sourceStart + to - from
      for await (const wrapped of source.audio.samples(sourceStart, sourceEnd)) {
        try {
        const outputStart = Math.max(0, Math.ceil((from - startSeconds) * rate), Math.ceil((from + wrapped.timestamp - sourceStart - startSeconds) * rate))
        const outputEnd = Math.min(length, Math.ceil((to - startSeconds) * rate), Math.ceil((from + wrapped.timestamp + wrapped.duration - sourceStart - startSeconds) * rate))
        for (let channel = 0; channel < 2; channel++) {
          const data = new Float32Array(wrapped.numberOfFrames)
          wrapped.copyTo(data, { planeIndex: Math.min(channel, wrapped.numberOfChannels - 1), format: 'f32-planar' })
          const output = result[channel]
          for (let sample = outputStart; sample < outputEnd; sample++) {
            const sourceTime = startSeconds + sample / rate - from + sourceStart - wrapped.timestamp
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
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose() }))
    await Promise.allSettled([...this.images.values()].map(async pending => (await pending).close()))
    this.sources.clear(); this.images.clear(); this.cache.clear(); this.cacheCanvas.width = 1; this.cacheCanvas.height = 1; this.canvas.width = 1; this.canvas.height = 1
  }
}
