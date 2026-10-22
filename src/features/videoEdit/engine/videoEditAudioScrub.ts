import { createLogger } from '@/core/logging'
import { fadeVideoEditAudio, VIDEO_EDIT_AUDIO_FADE_SECONDS } from './videoEditAudioScheduler'

const logger = createLogger('features.videoEdit.audio')
export const VIDEO_EDIT_SCRUB_INTERVAL_MS = 40
export const VIDEO_EDIT_SCRUB_SECONDS = 0.08

interface ScrubRequest {
  seconds: number
  fps: number
  endTime: number
  prepare(): Promise<{ context: BaseAudioContext; destination: AudioNode }>
  mix(from: number, duration: number): Promise<AudioBuffer>
  isCurrent(): boolean
  onError(error: unknown): void
}
interface Grain { node: AudioBufferSourceNode; gain: GainNode; context: BaseAudioContext }

/** 单个混音请求在途，等待期间只保留最新帧；不依赖画面完成，也不堵塞画面队列。 */
export class VideoEditAudioScrubber {
  private latest?: ScrubRequest
  private desired?: ScrubRequest
  private cache: Array<{ from: number; buffer: AudioBuffer }> = []
  private slowMix = false
  private timer?: ReturnType<typeof setTimeout>
  private busy = false
  private generation = 0
  private lastStarted = -Infinity
  private lastFrame?: number
  private grains = new Set<Grain>()

  request(request: ScrubRequest): void {
    const frame = Math.floor(request.seconds * request.fps + 1e-6)
    if (frame === this.lastFrame) return
    this.lastFrame = frame
    this.latest = request; this.desired = request
    this.schedule()
  }

  private cached(request: ScrubRequest): { from: number; buffer: AudioBuffer } | undefined {
    const length = Math.min(Math.max(VIDEO_EDIT_SCRUB_SECONDS, 1 / request.fps), request.endTime - request.seconds)
    return this.cache.find(entry => request.seconds >= entry.from && request.seconds + length <= entry.from + entry.buffer.duration + 1e-6)
  }

  private schedule(): void {
    if (this.timer !== undefined || !this.latest || this.busy && !this.cached(this.latest)) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, Math.max(0, this.lastStarted + VIDEO_EDIT_SCRUB_INTERVAL_MS - performance.now()))
  }

  private async flush(): Promise<void> {
    const request = this.latest
    if (!request) return
    this.latest = undefined
    let mixing = false
    const generation = this.generation
    const current = (): boolean => generation === this.generation && this.desired === request && request.isCurrent()
    try {
      const { context, destination } = await request.prepare()
      if (!current()) return
      const from = Math.round(request.seconds * context.sampleRate) / context.sampleRate
      const duration = Math.min(Math.max(VIDEO_EDIT_SCRUB_SECONDS, 1 / request.fps), request.endTime - from)
      if (duration <= 0) return
      let cached = this.cached(request)
      if (!cached) {
        if (this.busy) { if (current()) this.latest = request; return }
        mixing = true; this.busy = true
        // 慢效果链扩大为播放头附近的有界窗口；命中缓存时可越过正在预混的请求直接试听。
        const mixFrom = this.slowMix ? Math.max(0, Math.round((from - .15) * context.sampleRate) / context.sampleRate) : from
        const mixDuration = Math.min(this.slowMix ? Math.max(.5, duration + .15) : duration, request.endTime - mixFrom)
        const started = performance.now()
        logger.debug('擦洗混音开始', { event: 'video_edit.audio_scrub.start', context: { from: mixFrom, duration: mixDuration } })
        const buffer = await request.mix(mixFrom, mixDuration)
        const mixMs = performance.now() - started
        logger.debug('擦洗混音完成', { event: 'video_edit.audio_scrub.completed', context: { mixMs, stale: !current() } })
        if (generation !== this.generation) return
        this.slowMix ||= mixMs > 25
        cached = { from: mixFrom, buffer }
        this.cache = [cached, ...this.cache].slice(0, 2)
      }
      const { buffer } = cached
      if (!current()) return
      const when = Math.ceil(context.currentTime * context.sampleRate - 1e-6) / context.sampleRate
      const offset = Math.round((from - cached.from) * context.sampleRate) / context.sampleRate
      const length = Math.min(duration, buffer.duration - offset)
      if (length <= 0) return
      const fade = Math.min(VIDEO_EDIT_AUDIO_FADE_SECONDS, length / 2)
      // 旧段保留此刻的包络再淡出；新段从零淡入，重叠区采用线性交叉淡化。
      for (const grain of this.grains) grain.node.stop(fadeVideoEditAudio(grain.gain, grain.context.currentTime))
      const node = context.createBufferSource(); node.buffer = buffer
      const gain = context.createGain(); node.connect(gain); gain.connect(destination)
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(1, when + fade)
      gain.gain.setValueAtTime(1, when + length - fade)
      gain.gain.linearRampToValueAtTime(0, when + length)
      const grain = { node, gain, context }; this.grains.add(grain)
      node.onended = () => { this.grains.delete(grain); node.disconnect(); gain.disconnect() }
      node.start(when, offset, length)
      this.lastStarted = performance.now()
    } catch (error) {
      if (current()) {
        logger.warn('擦洗混音失败', { event: 'video_edit.audio_scrub.failed', error })
        request.onError(error)
      }
    } finally { if (mixing) this.busy = false; this.schedule() }
  }

  stop(): void {
    this.generation++; this.latest = undefined; this.desired = undefined; this.lastFrame = undefined; this.cache = []
    clearTimeout(this.timer); this.timer = undefined
    for (const grain of this.grains) grain.node.stop(fadeVideoEditAudio(grain.gain, grain.context.currentTime))
  }
}

/** 仅传递当前宿主的交互反馈，不进入文档、撤销栈或助手业务状态。 */
export interface VideoEditScrubIntent { scope: 'program' | 'source'; seconds: number }
const listeners = new Map<string, Set<(intent: VideoEditScrubIntent) => void>>()
export function requestVideoEditScrub(projectId: string, intent: VideoEditScrubIntent): void {
  listeners.get(projectId)?.forEach(listener => listener(intent))
}
export function subscribeVideoEditScrub(projectId: string, listener: (intent: VideoEditScrubIntent) => void): () => void {
  let group = listeners.get(projectId)
  if (!group) { group = new Set(); listeners.set(projectId, group) }
  group.add(listener)
  return () => { group.delete(listener); if (!group.size) listeners.delete(projectId) }
}
