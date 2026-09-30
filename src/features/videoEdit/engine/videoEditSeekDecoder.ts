import { ALL_FORMATS, EncodedPacketSink, Input, UrlSource, VideoSample, VideoSampleSink, type EncodedPacket } from 'mediabunny'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditGpuFrame } from './videoEditGpuFrame'

interface SeekWaiter { time: number; resolve: (sample: VideoSample | undefined) => void; reject: (error: Error) => void }
interface DecodeRange { start: number; end: number; iterator: AsyncGenerator<VideoSample, void, unknown>; waiters: Set<SeekWaiter>; cancelled: boolean; completed: boolean; prefetch: boolean }
/** Decode original GOPs once while nearby seeks reuse full-size owned GPU frames.
 * Owns its input independently from clip/page selection; never writes to disk. */
export class VideoEditSeekDecoder {
  private readonly input: Input
  private readonly ready
  private readonly ranges = new Map<number, DecodeRange>()
  private readonly jobs = new Set<Promise<void>>()
  private disposed = false
  private failure?: Error
  private compactOpaque = false
  private prefetchGeneration = 0
  private prefetchDirection = 0
  private readonly prefetched = new Map<number, ReturnType<typeof setTimeout>>()
  constructor(private readonly source: string, private readonly cache: VideoEditFrameCache, private readonly snapshot: (sample: VideoSample, compact: boolean) => Promise<VideoEditGpuFrame>) {
    this.input = new Input({ source: new UrlSource(source, { maxCacheSize: 32 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
    this.ready = this.initialize()
    void this.ready.catch(() => {}) // Retain rejection for sample(); disposal may precede initialization.
  }
  private async initialize(): Promise<{ packets: EncodedPacketSink; video: VideoSampleSink }> {
    const track = await this.input.getPrimaryVideoTrack()
    if (!track) throw new Error('素材没有可解码的视频轨。')
    const config = await track.getDecoderConfig()
    const supported = config && (await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true })).supported
    if (this.disposed) throw new Error('预览解码已关闭。')
    this.compactOpaque = !!config && /^avc[13]\.(42|4d|58|64)/i.test(config.codec)
    return { packets: new EncodedPacketSink(track), video: new VideoSampleSink(track, { hardwareAcceleration: supported ? 'prefer-hardware' : 'no-preference', optimizeForLatency: true }) }
  }
  private frame(time: number): VideoEditGpuFrame | undefined { return (this.cache.get(this.source, time) as VideoEditGpuFrame | undefined)?.clone() }
  private async range(key: EncodedPacket, prefetch = false, generation?: number): Promise<DecodeRange> {
    const existing = this.ranges.get(key.timestamp)
    if (existing) { if (!prefetch) existing.prefetch = false; return existing }
    const { video, packets } = await this.ready
    const next = await packets.getNextKeyPacket(key, { metadataOnly: true })
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (prefetch && generation !== undefined && generation !== this.prefetchGeneration) throw new Error('预取已取消。')
    // Recheck after I/O: two visible clips may request the same original GOP.
    const shared = this.ranges.get(key.timestamp)
    if (shared) { if (!prefetch) shared.prefetch = false; return shared }
    const end = next?.timestamp ?? Infinity
    const range: DecodeRange = { start: key.timestamp, end, iterator: video.samples(key.timestamp, end), waiters: new Set(), cancelled: false, completed: false, prefetch }
    this.ranges.set(key.timestamp, range)
    const job = this.decode(range)
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job))
    return range
  }
  private async decode(range: DecodeRange): Promise<void> {
    try {
      for await (const sample of range.iterator) {
        if (this.disposed || range.cancelled) { sample.close(); break }
        this.deliver(range, sample)
        try {
          const copy = await this.snapshot(sample, sample.format === 'I420' || sample.format === 'NV12' || (sample.format === null && this.compactOpaque))
          if (this.disposed || range.cancelled) copy.close()
          else {
            this.cache.put(this.source, copy, new Set())
            // Another render can request this frame while its GPU copy is in
            // flight. Deliver it before advancing; it will never arrive again
            // later in the GOP, even if the project changed in the meantime.
            this.deliver(range, sample)
          }
        } finally { sample.close() }
      }
      for (const waiter of range.waiters) waiter.resolve(undefined)
    } catch (error) {
      if (!this.disposed && !range.cancelled) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        for (const waiter of range.waiters) waiter.reject(this.failure)
      }
    } finally {
      range.completed = true
      range.waiters.clear()
      if (this.ranges.get(range.start) === range) this.ranges.delete(range.start)
    }
  }
  private deliver(range: DecodeRange, sample: VideoSample): void {
    for (const waiter of range.waiters) if (waiter.time >= sample.timestamp - 1e-7 && waiter.time < sample.timestamp + sample.duration - 1e-7) {
      range.waiters.delete(waiter); waiter.resolve(sample.clone())
    }
  }
  private cancelScheduled(): void {
    this.prefetchGeneration++
    for (const timer of this.prefetched.values()) clearTimeout(timer)
    this.prefetched.clear()
  }
  private prefetch(key: EncodedPacket, time: number): void {
    if (this.prefetched.has(key.timestamp) || this.prefetched.size + this.ranges.size >= 2) return
    const generation = this.prefetchGeneration
    // Decoder allocation can hold a driver lock. Defer speculative work briefly
    // so pointer-up cancels it before it competes with the exact foreground frame.
    const timer = setTimeout(() => {
      this.prefetched.delete(key.timestamp)
      if (this.disposed || this.failure || this.ranges.size >= 2 || this.cache.get(this.source, time)) return
      void this.range(key, true, generation).catch(error => {
        if (!this.disposed && generation === this.prefetchGeneration) this.failure = error instanceof Error ? error : new Error(String(error))
      })
    }, 50)
    this.prefetched.set(key.timestamp, timer)
  }
  async sample(time: number, direction: number): Promise<{ sample?: VideoSample | VideoEditGpuFrame; hit: boolean }> {
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (this.failure) throw this.failure
    const { packets } = await this.ready
    const key = await packets.getKeyPacket(time + 1e-7, { metadataOnly: true })
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (!key) return { hit: false }
    const directionChanged = this.prefetchDirection !== Math.sign(direction)
    if (direction === 0 || directionChanged) this.cancelScheduled()
    this.prefetchDirection = Math.sign(direction)
    const cached = this.frame(time)
    for (const range of this.ranges.values()) if (!range.waiters.size && (((direction === 0 || directionChanged) && range.prefetch) || time < range.start - 2 || time >= range.end + 2)) {
      range.cancelled = true
      this.ranges.delete(range.start)
      void Promise.allSettled([range.iterator.return()])
    }
    if (cached) {
      // Start before crossing the key-frame boundary, instead of resetting the
      // decoder at every reverse pointer event. Limit prefetch to one neighbor.
      try { if (this.ranges.size < 2) {
        const neighbor = direction < 0 && time - key.timestamp < 1.2 && key.timestamp > 0
          ? await packets.getKeyPacket(key.timestamp - 1e-6, { metadataOnly: true })
          : direction > 0 ? await packets.getNextKeyPacket(key, { metadataOnly: true }) : null
        const neighborTime = direction < 0 ? key.timestamp - 1e-6 : (neighbor?.timestamp ?? 0) + 1e-7
        if (neighbor && (direction < 0 || neighbor.timestamp - time < 1.2) && !this.cache.get(this.source, neighborTime)) this.prefetch(neighbor, neighborTime)
      } } catch (error) { cached.close(); throw error }
      if (this.disposed) { cached.close(); throw new Error('预览解码已关闭。') }
      return { sample: cached, hit: true }
    }
    const range = await this.range(key)
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (this.failure) throw this.failure
    const already = this.frame(time)
    if (already) return { sample: already, hit: true }
    if (range.completed) return { hit: false }
    return { sample: await new Promise<VideoSample | undefined>((resolve, reject) => range.waiters.add({ time, resolve, reject })), hit: false }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelScheduled()
    for (const range of this.ranges.values()) { range.cancelled = true; for (const waiter of range.waiters) waiter.reject(new Error('预览解码已关闭。')); range.waiters.clear() }
    await Promise.allSettled([...this.ranges.values()].map(range => range.iterator.return()))
    await Promise.allSettled(this.jobs)
    this.ranges.clear(); this.input.dispose(); this.cache.deleteMedia(this.source)
  }
}
