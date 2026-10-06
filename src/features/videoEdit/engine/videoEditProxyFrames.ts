import type { VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditDecodeSource, type VideoProxyResult } from '@/core/videoEdit/proxy'
import type { VideoEditFrameBackend, VideoEditFrameSource, VideoEditSnapshot, VideoEditFrameSeeker } from './videoEditFrameSource'
import type { VideoEditFrameCache } from './videoEditFrameCache'

/** The single picture-source selection, shared by native and WebCodecs through the existing router. Audio stays original. */
export class VideoEditProxyFrames implements VideoEditFrameBackend {
  private readonly handles = new Map<string, string[]>()
  private next = 0
  constructor(private readonly backend: VideoEditFrameBackend, private readonly proxies: Map<string, VideoProxyResult>) {}
  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    const picture = videoEditDecodeSource(media, this.proxies.get(media.id), true, 'playback')
    if (picture === media) return this.backend.open(media)
    const key = `proxy-${++this.next}`; const video = this.backend.open(picture); const handles = [video.key]
    this.handles.set(key, handles)
    let released = false
    let audio: ReturnType<VideoEditFrameBackend['open']> | undefined
    const backend = this.backend
    const owned = this.handles
    const live = (): void => { if (released || !owned.has(key)) { released = true; throw new Error('代理预览已关闭。') } }
    const ready = video.ready.then(source => { live(); return ({
      codec: source.codec,
      clipFrames: () => source.clipFrames(),
      schedule: (times: readonly number[]) => source.schedule(times),
      clipAudio: (stream?: number) => media.hasAudio === false ? undefined : {
        async *chunks(start: number, end: number, sampleRate?: number) {
          live()
          if (!audio) { audio = backend.open(media); handles.push(audio.key) }
          const original = await audio.ready
          live()
          const reader = original.clipAudio(stream)
          try { if (reader) yield* reader.chunks(start, end, sampleRate) } finally { reader?.close?.() }
        },
      },
    } satisfies VideoEditFrameSource) })
    return { key, ready }
  }
  release(key: string): void {
    const handles = this.handles.get(key)
    if (!handles) { this.backend.release(key); return }
    this.handles.delete(key); for (const handle of handles) this.backend.release(handle)
  }
  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    const picture = videoEditDecodeSource(media, this.proxies.get(media.id), true, 'playback')
    const seeker = this.backend.seeker(picture, cache, snapshot)
    if (picture === media) return seeker
    return { sample: (time, direction) => seeker.sample(time, direction), dispose: async () => { await seeker.dispose(); cache.deleteMedia(picture.path) } }
  }
}
