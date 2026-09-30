import { ALL_FORMATS, AudioSampleSink, VideoSampleSink, VideoSample, Input, UrlSource } from 'mediabunny'
import { activeVideoEditClips, clipSourceSeconds, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditSeekDecoder } from './videoEditSeekDecoder'
import { VideoEditGpuFrame } from './videoEditGpuFrame'

interface VideoSource {
  input: Input
  media: VideoEditMedia
  video?: VideoSampleSink
  audio?: AudioSampleSink
  iterator?: AsyncGenerator<VideoSample, void, unknown>
  current?: VideoSample | VideoEditGpuFrame
  previousTime: number
}
/** One bounded decoder per visible clip; all inputs close when the view detaches. */
export class VideoEditRenderer {
  private readonly sources = new Map<string, Promise<VideoSource>>()
  private readonly images = new Map<string, Promise<ImageBitmap>>()
  private disposed = false
  private readonly frameCache = new VideoEditFrameCache(8 * 1024 ** 3)
  private readonly seekers = new Map<string, VideoEditSeekDecoder>()
  readonly canvas: OffscreenCanvas
  private compositor?: VideoEditGpuCompositor
  constructor(public document: VideoEditDocument, private readonly previewWidth?: number, surface?: OffscreenCanvas) {
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
          return { input, media, video: video ? new VideoSampleSink(video, options) : undefined, audio: audio ? new AudioSampleSink(audio) : undefined, previousTime: -1 }
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
  async updateDocument(document: VideoEditDocument): Promise<void> {
    if (document.id !== this.document.id) throw new Error('渲染目标工程已经改变。')
    for (const [path, seeker] of this.seekers) if (!document.media.some(media => media.path === path)) { this.seekers.delete(path); await seeker.dispose() }
    for (const media of this.document.media) if (!document.media.some(item => item.id === media.id && item.path === media.path)) {
      const image = this.images.get(media.id); if (image) { this.images.delete(media.id); (await image).close() }
    }
    for (const [key, pending] of this.sources) {
      const source = await pending
      if (!document.media.some(item => item.id === source.media.id && item.path === source.media.path)) {
        this.sources.delete(key); source.current?.close(); await source.iterator?.return(); source.input.dispose()
      }
    }
    this.document = document
    if (this.canvas.width !== document.width || this.canvas.height !== document.height) { this.canvas.width = document.width; this.canvas.height = document.height }
  }
  cancelPresentation(): void { this.compositor?.cancelPresentation() }
  async render(frame: number, sequential = false, _scrubbing = false, shouldPresent: () => boolean = () => true, deadline?: number): Promise<{ canvas: OffscreenCanvas; sourceTimestamps: number[]; cacheHits: number; cacheBytes: number; presented: boolean; decodeMs: number; gpuMs: number; completion: Promise<void> }> {
    if (this.disposed) throw new Error('预览已关闭。')
    const active = activeVideoEditClips(this.document, frame).filter(clip => clip.kind !== 'audio')
    const timestamps: number[] = []
    this.compositor ??= new VideoEditGpuCompositor(this.canvas)
    const decodeStart = performance.now()
    this.frameCache.setHotFrames(active.flatMap(clip => {
      const media = this.document.media.find(media => media.id === clip.mediaId)
      return clip.kind === 'video' && media ? [{ mediaId: media.path, time: clipSourceSeconds(clip, frame, this.document.fps) }] : []
    }))
    let cacheHits = 0
    const settled = await Promise.allSettled(active.map(async clip => {
      const media = this.document.media.find(item => item.id === clip.mediaId)
      if (clip.kind === 'text') return null
      if (!media) throw new Error(`找不到素材 ${clip.name}`)
      if (media.kind === 'image') return this.image(media)
      const originalTime = clipSourceSeconds(clip, frame, this.document.fps)
      const time = originalTime
      const source = await this.source(clip.id, media)
      if (!source.video) throw new Error(`素材 ${media.name} 没有可解码的视频轨。`)
      if (this.previewWidth && !sequential) {
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
      timestamps.push(source.current.timestamp)
      return source.current
    }))
    const failure = settled.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const pictures = settled.map(result => { if (result.status !== 'fulfilled') throw new Error('剪辑画面准备失败。'); return result.value })
    if (this.disposed) throw new Error('预览已关闭。')
    const decodeMs = performance.now() - decodeStart
    const gpuStart = performance.now()
    const { presented, completion } = await this.compositor.draw(this.document, active, pictures, shouldPresent, deadline)
    const gpuMs = performance.now() - gpuStart
    const activeIds = new Set(active.map(clip => clip.id))
    for (const [key, pending] of this.sources) if (!activeIds.has(key) && !key.startsWith('audio:')) {
      this.sources.delete(key); const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose()
    }
    const activeImages = new Set(active.filter(clip => clip.kind === 'image').map(clip => clip.mediaId))
    for (const [key, pending] of this.images) if (!activeImages.has(key)) {
      this.images.delete(key); (await pending).close()
    }
    const activePaths = new Set(active.map(clip => this.document.media.find(media => media.id === clip.mediaId)?.path))
    for (const [path, seeker] of this.seekers) if (!activePaths.has(path)) { this.seekers.delete(path); await seeker.dispose() }
    return { canvas: this.canvas, sourceTimestamps: timestamps, cacheHits, cacheBytes: this.frameCache.bytes, presented, decodeMs, gpuMs, completion }
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
    await Promise.allSettled([...this.seekers.values()].map(seeker => seeker.dispose())); this.seekers.clear(); this.frameCache.clear()
    await Promise.allSettled([...this.sources.values()].map(async pending => { const source = await pending; source.current?.close(); await source.iterator?.return(); source.input.dispose() }))
    await Promise.allSettled([...this.images.values()].map(async pending => (await pending).close()))
    this.sources.clear(); this.images.clear(); await this.compositor?.dispose(); this.canvas.width = 1; this.canvas.height = 1
  }
}
