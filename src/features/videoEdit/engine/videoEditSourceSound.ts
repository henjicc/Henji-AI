import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from './videoEditAudioMeter'
import { VideoEditAudioScheduler } from './videoEditAudioScheduler'
import { VideoEditRenderSession } from './videoEditRenderSession'

/** Source monitor sound runs at this rate (the program default); the native service resamples to it. */
const SOURCE_SOUND_RATE = 48000

/**
 * A one-clip sequence that plays the first sound stream of `media` from its start, at full volume: timeline seconds
 * equal source seconds. Mixed by its own render session, so the source monitor hears exactly what the program mix
 * would (same decoding backend, resampling and channel mapping).
 */
export function videoEditSourceSoundComposition(media: VideoEditMedia): VideoEditComposition {
  if (media.kind === 'image' || !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) throw new Error('源声音需要具有有效时长的音视频素材。')
  const frameRate = media.frameRate ? { ...media.frameRate } : { numerator: 30, denominator: 1 }
  const fps = videoEditFps(frameRate)
  const itemId = crypto.randomUUID()
  return {
    id: crypto.randomUUID(), name: media.name, revision: 0,
    width: media.kind === 'video' && media.width > 0 ? media.width : 16, height: media.kind === 'video' && media.height > 0 ? media.height : 16, frameRate, fps,
    pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: SOURCE_SOUND_RATE, channels: 2,
    media: [{ ...media, ...(media.frameRate ? { frameRate: { ...media.frameRate } } : {}) }],
    items: [{ id: itemId, name: media.name, kind: media.kind, mediaId: media.id }],
    tracks: [{ id: crypto.randomUUID(), name: media.name, index: 0, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
    clips: [{ id: crypto.randomUUID(), itemId, name: media.name, kind: 'audio', sourceComponent: 'audio', track: 0, start: 0, duration: Math.max(1, Math.ceil(media.durationSeconds * fps - 1e-6)),
      sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }],
    annotations: [],
  }
}

/**
 * Forward playback sound of a source item the media element cannot play (files only the native decoder reads,
 * task 2.3): mixed blocks from a dedicated render session, placed on an audio clock aligned with the picture clock,
 * through the monitor volume and a level meter. Reverse and paused playback are silent, like the program monitor.
 */
export class VideoEditSourceSoundPlayer {
  private context?: AudioContext
  private gain?: GainNode
  private meter?: ReturnType<typeof createVideoEditAudioMeter>
  private session?: VideoEditRenderSession
  private readonly scheduler = new VideoEditAudioScheduler()
  private origin = 0
  private disposed = false

  constructor(private readonly media: VideoEditMedia, private readonly createSession: (document: VideoEditComposition) => VideoEditRenderSession = document => new VideoEditRenderSession(document)) {}

  /** Starts the audio clock (it may need a user gesture or a device wake-up) and applies the monitor volume. */
  async prepare(volume: number): Promise<void> {
    if (this.disposed) throw new Error('源声音已关闭。')
    const context = this.context ??= new AudioContext({ sampleRate: SOURCE_SOUND_RATE })
    this.meter ??= createVideoEditAudioMeter(context, 2)
    if (!this.gain) { this.gain = context.createGain(); this.gain.connect(this.meter.input) }
    this.gain.gain.value = Math.min(1, Math.max(0, volume))
    await context.resume()
    // Like the program monitor: place blocks only once the audio clock actually runs.
    const before = context.currentTime; const waiting = performance.now()
    while (context.currentTime === before && performance.now() - waiting < 1000 && !this.disposed) await new Promise(resolve => setTimeout(resolve, 2))
  }

  /** Source second `seconds` sounds at `at` on the `performance.now()` clock (where the picture clock puts it). */
  start(seconds: number, at: number): void {
    if (!this.context) throw new Error('源声音尚未就绪。')
    this.scheduler.stop()
    this.origin = this.context.currentTime + (at - performance.now()) / 1000 - seconds
    this.scheduler.start(seconds)
  }

  /** Requests the next block when the playback position `seconds` is close enough to it. */
  pump(seconds: number, isCurrent: () => boolean, onError: (error: unknown) => void): void {
    const { context, gain } = this
    if (!context || !gain || this.disposed) return
    this.scheduler.pump({
      context, destination: gain, origin: this.origin, timelineTime: seconds, endTime: this.media.durationSeconds,
      mix: (from, duration) => (this.session ??= this.createSession(videoEditSourceSoundComposition(this.media))).mixAudio(from, duration),
      isCurrent: () => !this.disposed && isCurrent(), onError,
    })
  }

  levels(): VideoEditAudioLevel[] { return this.meter?.read() ?? [] }

  /** Silences placed blocks and discards blocks still being mixed. */
  stop(): void { this.scheduler.stop() }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.stop()
    this.meter?.dispose(); this.gain?.disconnect()
    await Promise.allSettled([this.context?.close(), this.session?.dispose()])
  }
}
