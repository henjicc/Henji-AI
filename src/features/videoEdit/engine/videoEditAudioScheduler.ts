export const VIDEO_EDIT_AUDIO_BLOCK_SECONDS = 0.5
export const VIDEO_EDIT_AUDIO_LOOKAHEAD_SECONDS = 0.4
export const VIDEO_EDIT_AUDIO_FADE_SECONDS = 0.005
/**
 * 同时在混的块上限（含停止后仍在混、结果会被丢弃的旧块）。混音在渲染会话里串行执行、请求数有上限：
 * 连续起停或定位时不能每次都再排一块，否则旧块堆满队列，新的混音被拒、播放被迫停下。
 */
const VIDEO_EDIT_AUDIO_MIXES_IN_FLIGHT = 2

export interface VideoEditAudioPump {
  context: BaseAudioContext
  destination: AudioNode
  origin: number
  timelineTime: number
  endTime: number
  mix(from: number, duration: number): Promise<AudioBuffer>
  isCurrent(): boolean
  onError(error: unknown): void
}

/** 保留当前包络值再淡出，快速起停时也不会跳回满幅。 */
export function fadeVideoEditAudio(gain: GainNode, at: number): number {
  gain.gain.cancelAndHoldAtTime(at)
  const end = at + VIDEO_EDIT_AUDIO_FADE_SECONDS
  gain.gain.linearRampToValueAtTime(0, end)
  return end
}

/** 关闭设备或断开总线前，留出已排入音频时钟的淡出尾部。 */
export async function finishVideoEditAudioFade(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, VIDEO_EDIT_AUDIO_FADE_SECONDS * 1000 + 5))
}

interface AudioRun {
  context: BaseAudioContext
  gain: GainNode
  nodes: Set<AudioBufferSourceNode>
  originFrame: number
  retired: boolean
  started: boolean
}

/** 节目和源监视器共用：整数采样帧排块，每轮独立包络，旧异步结果不能影响新播放。 */
export class VideoEditAudioScheduler {
  private run?: AudioRun
  private generation = 0
  private pending = false
  /** 还没回来的混音块数，跨越停止与重新开始。 */
  private mixing = 0
  private from = 0
  private nextFrame?: number

  start(from: number): void {
    this.stop()
    this.from = from
    this.nextFrame = undefined
  }

  pump(request: VideoEditAudioPump): void {
    const { context } = request
    const rate = context.sampleRate
    const fromFrame = this.nextFrame ?? Math.round(this.from * rate)
    const endFrame = Math.round(request.endTime * rate)
    if (this.pending || this.mixing >= VIDEO_EDIT_AUDIO_MIXES_IN_FLIGHT || fromFrame >= Math.round((request.timelineTime + VIDEO_EDIT_AUDIO_LOOKAHEAD_SECONDS) * rate) || fromFrame >= endFrame) return
    if (!this.run) {
      const gain = context.createGain(); gain.gain.value = 0; gain.connect(request.destination)
      this.run = { context, gain, nodes: new Set(), originFrame: Math.round(request.origin * rate), retired: false, started: false }
    }
    const run = this.run
    const frames = Math.min(Math.round(VIDEO_EDIT_AUDIO_BLOCK_SECONDS * rate), endFrame - fromFrame)
    this.nextFrame = fromFrame + frames; this.pending = true; this.mixing++
    const generation = this.generation
    void request.mix(fromFrame / rate, frames / rate).then(buffer => {
      if (generation !== this.generation || !request.isCurrent()) return
      const scheduledFrame = run.originFrame + fromFrame
      const nowFrame = Math.ceil(context.currentTime * rate - 1e-6)
      const offsetFrame = Math.max(0, nowFrame - scheduledFrame)
      const availableFrames = Math.min(frames, Math.round(buffer.duration * rate))
      if (offsetFrame >= availableFrames) return
      const when = Math.max(scheduledFrame, nowFrame) / rate
      const fade = Math.min(VIDEO_EDIT_AUDIO_FADE_SECONDS, (availableFrames - offsetFrame) / rate / 2)
      const node = context.createBufferSource(); node.buffer = buffer
      let entry: GainNode | undefined
      if (!run.started) {
        run.gain.gain.setValueAtTime(0, when)
        run.gain.gain.linearRampToValueAtTime(1, when + fade)
        run.started = true
      } else if (offsetFrame > 0) {
        entry = context.createGain(); entry.gain.setValueAtTime(0, when)
        entry.gain.linearRampToValueAtTime(1, when + fade)
        entry.connect(run.gain)
      }
      // 最后一块自然结束也要淡出；普通相邻块之间不加包络，避免周期性音量凹陷。
      if (fromFrame + frames === endFrame) {
        const end = (scheduledFrame + availableFrames) / rate
        run.gain.gain.setValueAtTime(1, Math.max(when + fade, end - fade))
        run.gain.gain.linearRampToValueAtTime(0, end)
      }
      node.connect(entry ?? run.gain); run.nodes.add(node)
      node.onended = () => {
        run.nodes.delete(node); node.disconnect(); entry?.disconnect()
        if (run.retired && !run.nodes.size) run.gain.disconnect()
      }
      node.start(when, offsetFrame / rate, (availableFrames - offsetFrame) / rate)
    }).catch(error => {
      if (generation === this.generation && request.isCurrent()) request.onError(error)
    }).finally(() => { this.mixing--; if (generation === this.generation) this.pending = false })
  }

  stop(): void {
    this.generation++; this.pending = false
    const run = this.run; this.run = undefined
    if (!run) return
    run.retired = true
    const end = fadeVideoEditAudio(run.gain, run.context.currentTime)
    for (const node of run.nodes) node.stop(end)
    if (!run.nodes.size) run.gain.disconnect()
  }
}
