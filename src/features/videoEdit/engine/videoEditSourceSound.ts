import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditAudioMapping } from '@/core/videoEdit/audioChannels'
import { videoEditFps } from '@/core/videoEdit/time'
import { AUDIO_SCRUB_STEP_SECONDS, AudioScrubEngine, type AudioScrubSource } from '@/services/audioScrub/audioScrubEngine'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from './videoEditAudioMeter'
import { finishVideoEditAudioFade, VideoEditAudioScheduler } from './videoEditAudioScheduler'
import { dispatchingVideoEditScrubKind, videoEditScrubSource } from './videoEditAudioScrub'
import { VideoEditRenderSession } from './videoEditRenderSession'

/** Source monitor sound runs at this rate (the program default); the native service resamples to it. */
const SOURCE_SOUND_RATE = 48000

/**
 * A sequence that plays `media` from its start, at full volume: timeline seconds equal source seconds. Mixed by its
 * own render session, so the source monitor hears exactly what the program mix would (same decoding backend,
 * resampling and channel mapping). With the item's audio layout (task 2.6, Premiere's source monitor plays every
 * audio clip of the item) there is one clip per layout entry; without it the first sound stream plays.
 */
export function videoEditSourceSoundComposition(media: VideoEditMedia, layout?: readonly VideoEditAudioMapping[]): VideoEditComposition {
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
    clips: (layout?.length ? layout : [undefined]).map(mapping => ({ id: crypto.randomUUID(), itemId, name: media.name, kind: 'audio' as const, sourceComponent: 'audio' as const, track: 0, start: 0, duration: Math.max(1, Math.ceil(media.durationSeconds * fps - 1e-6)),
      sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', ...(mapping ? { audioMapping: structuredClone(mapping) } : {}) })),
    annotations: [],
  }
}

/** 源声音使用专用渲染会话混音，经监视器音量和电平输出；支持正向播放与暂停时的显式擦洗试听。 */
export class VideoEditSourceSoundPlayer {
  private context?: AudioContext
  private gain?: GainNode
  private meter?: ReturnType<typeof createVideoEditAudioMeter>
  private session?: VideoEditRenderSession
  private readonly scheduler = new VideoEditAudioScheduler()
  private readonly scrubber = new AudioScrubEngine({ onError: error => this.scrubFailed?.(error) })
  private scrubSource?: AudioScrubSource
  private scrubFailed?: (error: unknown) => void
  private scrubPreparing?: Promise<void>
  private origin = 0
  private disposed = false

  constructor(private readonly media: VideoEditMedia, private readonly createSession: (document: VideoEditComposition) => VideoEditRenderSession = document => new VideoEditRenderSession(document), private readonly layout?: readonly VideoEditAudioMapping[]) {}

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
    this.stop()
    this.origin = this.context.currentTime + (at - performance.now()) / 1000 - seconds
    this.scheduler.start(seconds)
  }

  /** Requests the next block when the playback position `seconds` is close enough to it. */
  pump(seconds: number, isCurrent: () => boolean, onError: (error: unknown) => void): void {
    const { context, gain } = this
    if (!context || !gain || this.disposed) return
    this.scheduler.pump({
      context, destination: gain, origin: this.origin, timelineTime: seconds, endTime: this.media.durationSeconds,
      mix: (from, duration) => (this.session ??= this.createSession(videoEditSourceSoundComposition(this.media, this.layout))).mixAudio(from, duration),
      isCurrent: () => !this.disposed && isCurrent(), onError,
    })
  }

  levels(): VideoEditAudioLevel[] { return this.meter?.read() ?? [] }

  /**
   * 原生与媒体元素源的擦洗均复用正式源混音，音量及电平保持一致；声音由共用擦洗引擎播放（拖动时原速片段跟着指针走，单步一小段原速）。
   * 单步命令经 requestVideoEditScrub 派发，派发期间到达的请求按单步播放。
   */
  scrub(seconds: number, volume: number, isCurrent: () => boolean, onError: (error: unknown) => void): void {
    if (this.disposed) return
    this.scheduler.stop()
    const step = dispatchingVideoEditScrubKind() === 'step'
    const fps = this.media.frameRate ? videoEditFps(this.media.frameRate) : 30
    const at = performance.now()
    this.scrubFailed = error => { if (!this.disposed && isCurrent()) onError(error) }
    const apply = (): void => {
      if (this.disposed || !this.context || !this.gain) return
      this.scrubber.attach({ context: this.context, destination: this.gain })
      this.scrubber.setSource(this.scrubSource ??= videoEditScrubSource(SOURCE_SOUND_RATE, this.media.durationSeconds, (from, duration) => (this.session ??= this.createSession(videoEditSourceSoundComposition(this.media, this.layout))).mixAudio(from, duration)))
      if (step) this.scrubber.step(seconds, Math.max(AUDIO_SCRUB_STEP_SECONDS, 1 / fps))
      else this.scrubber.move(seconds, { quantum: 1 / fps, at })
    }
    if (this.context?.state === 'running' && this.gain) { this.gain.gain.value = Math.min(1, Math.max(0, volume)); apply(); return }
    // 第一次（或设备挂起后）先唤醒音频时钟；期间的请求按原顺序、原时刻补上。
    const preparing = this.scrubPreparing ??= this.prepare(volume).finally(() => { if (this.scrubPreparing === preparing) this.scrubPreparing = undefined })
    preparing.then(apply, (error: unknown) => { if (!this.disposed && isCurrent()) onError(error) })
  }

  /** Silences placed blocks and discards blocks still being mixed. */
  stop(): void { this.scheduler.stop(); this.scrubber.stop() }
  stopPlayback(): void { this.scheduler.stop() }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    await Promise.all([finishVideoEditAudioFade(), this.scrubber.dispose()])
    this.meter?.dispose(); this.gain?.disconnect()
    await Promise.allSettled([this.context?.close(), this.session?.dispose()])
  }
}
