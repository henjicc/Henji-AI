import { ALL_FORMATS, AudioSampleSink, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import type { VideoEditClipAudio, VideoEditClipFrames, VideoEditFrameBackend, VideoEditFrameSeeker, VideoEditFrameSource, VideoEditSnapshot } from './videoEditFrameSource'
import { scheduledVideoSamples } from './videoEditPlaybackDecoder'
import { VideoEditSeekDecoder } from './videoEditSeekDecoder'
import { videoEditSourceReadError } from './videoEditSourceErrors'

type DecodeOptions = { hardwareAcceleration: 'prefer-hardware' | 'no-preference'; optimizeForLatency: true }
type VideoTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>
type AudioTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>

/** Chromium decodes every stream of a file: the measure media import and backend choices use. */
async function tracksDecodable(video: VideoTrack | null, audio: AudioTrack | null): Promise<boolean> {
  if (!video && !audio) return false
  const [pictures, sound] = await Promise.all([video?.canDecode() ?? true, audio?.canDecode() ?? true])
  return pictures && sound
}

/** Whether Chromium decodes every stream of the file at `url` (a fetchable URL); rejects when it cannot read it. */
export async function videoEditBrowserDecodable(url: string): Promise<boolean> {
  const input = new Input({ source: new UrlSource(url, { maxCacheSize: 8 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
  try { return await tracksDecodable(...await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])) } finally { input.dispose() }
}

/** Chromium decoding of one parsed file: mediabunny demuxing and WebCodecs decoders. */
class BrowserFrameSource implements VideoEditFrameSource {
  constructor(private readonly video: VideoTrack | null, private readonly audio: AudioTrack | null, private readonly options: DecodeOptions, readonly codec?: string) {}
  clipFrames(): VideoEditClipFrames | undefined {
    if (!this.video) return undefined
    // Sequential playback decodes the original compressed stream.
    const sink = new VideoSampleSink(this.video, this.options)
    return { frames: start => sink.samples(start), frameAt: seconds => sink.getSample(seconds) }
  }
  clipAudio(): VideoEditClipAudio | undefined {
    if (!this.audio) return undefined
    const sink = new AudioSampleSink(this.audio)
    return { chunks: (start, end) => sink.samples(start, end) }
  }
  /** Chromium decodes every stream of the file (the import probe's measure; asked only when choosing a backend). */
  decodable(): Promise<boolean> { return tracksDecodable(this.video, this.audio) }
  async *schedule(timestamps: readonly number[]): AsyncGenerator<VideoSample | null, void, unknown> {
    if (!this.video) return
    // H.264 plays through one decoder that never flushes mid-playback; other codecs keep mediabunny's path.
    if (this.codec?.startsWith('avc')) yield* scheduledVideoSamples(this.video, this.options, timestamps)
    else yield* new VideoSampleSink(this.video, this.options).samplesAtTimestamps(timestamps)
  }
}

/**
 * The browser backend: one parsed container per source file and revision. Clips of the same file (cuts, repeats)
 * only create their own sinks/decoder iterators, so a cut never re-opens and re-parses the file on the playback path.
 */
export class VideoEditBrowserFrames implements VideoEditFrameBackend {
  private readonly inputs = new Map<string, { users: number; input: Input; ready: Promise<VideoEditFrameSource> }>()
  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
    let entry = this.inputs.get(key)
    if (!entry) {
      const input = new Input({ source: new UrlSource(media.path, { maxCacheSize: 32 * 1024 * 1024, getRetryDelay: () => null }), formats: ALL_FORMATS })
      const ready = (async (): Promise<VideoEditFrameSource> => {
        const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]).catch(error => { throw videoEditSourceReadError(media.name, error) })
        const config = video ? await video.getDecoderConfig() : null
        const preference = 'prefer-hardware'
        const supported = config && (await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: preference, optimizeForLatency: true })).supported
        return new BrowserFrameSource(video, audio, { hardwareAcceleration: supported ? preference : 'no-preference', optimizeForLatency: true }, config?.codec)
      })()
      const created = { users: 0, input, ready }
      // A failed open is not cached: a restored or relinked file must be read again.
      ready.catch(() => { if (this.inputs.get(key) === created) { this.inputs.delete(key); input.dispose() } })
      entry = created
      this.inputs.set(key, entry)
    }
    entry.users++
    return { key, ready: entry.ready }
  }
  release(key: string): void {
    const entry = this.inputs.get(key)
    if (!entry || --entry.users > 0) return
    this.inputs.delete(key); entry.input.dispose()
  }
  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    return new VideoEditSeekDecoder(media.path, cache, snapshot)
  }
}
