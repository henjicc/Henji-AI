import { AUDIO_SCRUB_STEP_SECONDS, AudioScrubEngine, type AudioScrubOutput, type AudioScrubSource } from '@/services/audioScrub/audioScrubEngine'

/** 擦洗声音的两种手势：拖动播放头（原速片段跟着指针走）与单步（方向键、逐帧，播放一小段原速声音）。 */
export type VideoEditScrubKind = 'drag' | 'step'

interface ScrubRequest {
  seconds: number
  fps: number
  endTime: number
  prepare(): Promise<AudioScrubOutput>
  mix(from: number, duration: number): Promise<AudioBuffer>
  isCurrent(): boolean
  onError(error: unknown): void
  /** 手势；不传时按 requestVideoEditScrub 正在派发的意图判断（单步命令经它派发），否则按拖动。 */
  mode?: VideoEditScrubKind
}

/** 混音的采样率与输出设备不同（换了不同采样率的序列）：换一份来源重取，不算失败。 */
class ScrubRateChanged extends Error {}

/** 剪辑混音作为擦洗声音来源：按块调用渲染会话混音，块边界按采样帧对齐（混音器按起点向上取整到采样）。 */
export function videoEditScrubSource(sampleRate: number, durationSeconds: number, mix: (from: number, duration: number) => Promise<AudioBuffer>, channels = 2): AudioScrubSource {
  return {
    sampleRate, channels, frames: Math.max(0, Math.round(durationSeconds * sampleRate)),
    async read(start, frames) {
      const buffer = await mix(start / sampleRate, frames / sampleRate)
      if (buffer.sampleRate !== sampleRate) throw new ScrubRateChanged(String(buffer.sampleRate))
      return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
    },
  }
}

/**
 * 节目监视器的擦洗声音：把逐次请求转给共用擦洗引擎（services/audioScrub）。指针位置一到就交给音频线程，
 * 混音在后台按块进行；同一份序列已混的声音跨手势保留（上一手势的请求仍有效时），反复拖同一段不再重混。
 */
export class VideoEditAudioScrubber {
  private readonly engine = new AudioScrubEngine({ onError: error => this.failed(error) })
  private latest?: ScrubRequest
  private owner?: ScrubRequest
  private output?: AudioScrubOutput
  private mixRate?: number
  private preparing = false
  private prepared = false
  private session = 0
  private pending: Array<() => void> = []
  private lastSeconds?: number

  request(request: ScrubRequest): void {
    const mode = request.mode ?? dispatchingVideoEditScrubKind() ?? 'drag'
    if (mode === 'drag' && request.seconds === this.lastSeconds) return
    this.lastSeconds = mode === 'drag' ? request.seconds : undefined
    // 新手势开始时核对上一份声音是否仍然有效（文档、序列没变）；无效就换来源。
    if (!this.prepared && this.owner && this.owner !== request && !this.owner.isCurrent()) this.owner = undefined
    this.latest = request
    const at = performance.now()
    const apply = (): void => {
      if (!this.ensureSource(request)) return
      if (mode === 'step') this.engine.step(request.seconds, Math.max(AUDIO_SCRUB_STEP_SECONDS, 1 / request.fps))
      else this.engine.move(request.seconds, { quantum: 1 / request.fps, at })
    }
    this.prepare(request)
    // 上一手势已有输出就立刻发声，设备恢复在后台核对；第一次要等输出就绪。
    if (this.output) apply()
    else this.pending.push(apply)
  }

  stop(): void {
    this.session++
    this.prepared = false
    this.preparing = false
    this.pending = []
    this.lastSeconds = undefined
    this.engine.stop()
  }

  private prepare(request: ScrubRequest): void {
    if (this.prepared || this.preparing) return
    this.preparing = true
    const session = this.session
    request.prepare().then(output => {
      if (session !== this.session) return
      this.preparing = false
      this.prepared = true
      if (this.output && (this.output.context !== output.context || this.output.destination !== output.destination)) this.owner = undefined
      this.output = output
      this.engine.attach(output)
      const pending = this.pending
      this.pending = []
      for (const apply of pending) apply()
    }, (error: unknown) => {
      if (session !== this.session) return
      this.preparing = false
      this.pending = []
      if (request.isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) request.onError(error)
    })
  }

  private ensureSource(request: ScrubRequest): boolean {
    const output = this.output
    if (!output) return false
    if (!this.owner || !this.engine.currentSource) {
      this.owner = request
      const rate = this.mixRate ?? output.context.sampleRate
      this.engine.setSource(videoEditScrubSource(rate, request.endTime, (from, duration) => (this.latest ?? request).mix(from, duration)))
    }
    return true
  }

  private failed(error: unknown): void {
    if (error instanceof ScrubRateChanged) {
      this.mixRate = Number(error.message)
      this.owner = undefined
      this.engine.setSource(undefined)
      return
    }
    if (this.latest?.isCurrent()) this.latest.onError(error)
  }
}

/** 仅传递当前宿主的交互反馈，不进入文档、撤销栈或助手业务状态。 */
export interface VideoEditScrubIntent { scope: 'program' | 'source'; seconds: number; kind?: VideoEditScrubKind }
const listeners = new Map<string, Set<(intent: VideoEditScrubIntent) => void>>()
let dispatching: VideoEditScrubIntent | undefined
export function requestVideoEditScrub(projectId: string, intent: VideoEditScrubIntent): void {
  const outer = dispatching
  dispatching = intent
  try { listeners.get(projectId)?.forEach(listener => listener(intent)) } finally { dispatching = outer }
}
/**
 * 正在同步派发的擦洗意图的手势（派发期间有效，不带 kind 的意图是单步命令）：监听方转手调用擦洗声音时不必逐层传递手势。
 * 不在派发中返回 undefined。
 */
export function dispatchingVideoEditScrubKind(): VideoEditScrubKind | undefined {
  return dispatching ? dispatching.kind ?? 'step' : undefined
}
export function subscribeVideoEditScrub(projectId: string, listener: (intent: VideoEditScrubIntent) => void): () => void {
  let group = listeners.get(projectId)
  if (!group) { group = new Set(); listeners.set(projectId, group) }
  group.add(listener)
  return () => { group.delete(listener); if (!group.size) listeners.delete(projectId) }
}
