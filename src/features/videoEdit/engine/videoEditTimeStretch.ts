import { SignalsmithStretchWasm, type SignalsmithStretchModule } from 'signalsmith-stretch'
import { readVideoEditSourceBuffer, type VideoEditRetimedSoundRequest, type VideoEditSourceBuffer } from './videoEditRetimedAudio'
import { VIDEO_EDIT_PITCH_STRETCH_MAX, videoEditClipSourceSecondsAtTime } from '@/core/videoEdit/clipSpeed'

/**
 * 变速保持音调与变调（4.13 / 时间重映射）：Signalsmith Stretch（MIT，官方 WASM 构建）直接按源时间做时间拉伸，
 * 取代原来的“按位置重采样 + smbPitchShift 相位声码器补偿”。选型与 A/B 实测见提交正文。
 *
 * - 输出按序列样本的绝对网格分块（`VIDEO_EDIT_STRETCH_BLOCK`）：调用方无论怎样切块，只要前后连续，送进拉伸器的
 *   每一块都相同，预览与导出逐样本一致；请求不连续（跳播、预读）时在所在网格块重新定位（seek）。
 * - 闭环纠偏：每块结束时应送入的输入位置由同一个映射函数（`sourceAt`，片段源时间换算唯一入口）重新求出，
 *   本块送入的样本数 = 目标位置 − 已送入位置，取整误差留到下一块抵消，长片段不会累计漂移；拉伸器的
 *   输入延迟与输出延迟在目标位置里一并补偿。
 * - 源时间倒退（倒放）时把源样本倒序送入：输入坐标 u = 方向 × 源样本号，始终递增。
 * - 变调用 transpose 因子：源采样率与序列采样率不同的换算 × 不保持音调时的磁带式升降（局部速度）× 半音。
 */
/** 拉伸器的网格块长（序列样本）。 */
export const VIDEO_EDIT_STRETCH_BLOCK = 512
const TONALITY_LIMIT_HZ = 8000


/** 序列样本 → 输入坐标（方向 × 源样本号，可带小数）。 */
export type VideoEditStretchInputAt = (sequenceSample: number) => number
/** 把输入坐标 [from, from+count) 的样本写进各声道（越出素材的部分写 0）。 */
export type VideoEditStretchInputRead = (from: number, count: number, planes: Float32Array[]) => void

/**
 * 一个片段的拉伸器（每个混音片段一个 WASM 实例，状态跨块延续）。`nextSample` 是下一块连续输出应从哪个序列样本开始。
 */
export class VideoEditTimeStretcher {
  private inputPointer = 0; private outputPointer = 0; private bufferLength = 0
  readonly inputLatency: number; readonly outputLatency: number
  /** 已送入的输入坐标（下一个要送的样本）。 */
  private fed = 0
  /** 已生成到的序列样本（网格对齐）；undefined 表示需要重新定位。 */
  private produced?: number
  /** 最后一块的输出（同一块被下一次请求继续使用时取这里）。 */
  private readonly carry: Float32Array[]
  private carryStart = Number.NaN
  /** 当前送入的源采样率（换源或采样率变化时重新定位）。 */
  sourceRate = 0
  private constructor(private readonly module: SignalsmithStretchModule, readonly channels: number, readonly rate: number) {
    module._main?.()
    module._presetDefault(channels, rate)
    this.inputLatency = module._inputLatency(); this.outputLatency = module._outputLatency()
    this.allocate(Math.max(this.inputLatency + this.outputLatency, Math.ceil(VIDEO_EDIT_STRETCH_BLOCK * VIDEO_EDIT_PITCH_STRETCH_MAX) + 8))
    this.carry = Array.from({ length: channels }, () => new Float32Array(VIDEO_EDIT_STRETCH_BLOCK))
  }
  static async create(channels: number, rate: number): Promise<VideoEditTimeStretcher> {
    // 静态导入：WASM 内嵌在模块里（约 110 KB）；渲染 Worker 里的动态导入会让 Vite 生产构建重复产出同名分块。
    return new VideoEditTimeStretcher(await SignalsmithStretchWasm(), channels, rate)
  }
  /** 用给定模块实例（测试替身可记录每次送入的样本数）。 */
  static fromModule(module: SignalsmithStretchModule, channels: number, rate: number): VideoEditTimeStretcher { return new VideoEditTimeStretcher(module, channels, rate) }
  /** 已送入的输入位置（输入坐标）。 */
  get inputPosition(): number { return this.fed }
  private allocate(length: number): void {
    this.bufferLength = length
    const pointer = this.module._setBuffers(this.channels, length)
    this.inputPointer = pointer; this.outputPointer = pointer + length * 4 * this.channels
  }
  private plane(pointer: number, channel: number, length: number): Float32Array { return new Float32Array(this.module.HEAP8.buffer, pointer + channel * this.bufferLength * 4, length) }
  /** 清空状态（下一次请求重新定位）。 */
  invalidate(): void { this.produced = undefined; this.carryStart = Number.NaN }
  /**
   * 生成序列样本 [first, first+length) 的拉伸输出，`write(sample, channel, value)` 逐样本交给调用方（加增益、累加）。
   * `transposeAt` 给出网格块起点处的变调因子。
   */
  render(first: number, length: number, inputAt: VideoEditStretchInputAt, read: VideoEditStretchInputRead, transposeAt: (sequenceSample: number) => number, write: (sample: number, channel: number, value: number) => void): void {
    if (length <= 0) return
    const block = VIDEO_EDIT_STRETCH_BLOCK; const end = first + length
    let cursor = first
    // 上一次请求留下的同一块：直接取。
    if (this.produced !== undefined && first >= this.carryStart && first < this.produced) {
      for (; cursor < Math.min(end, this.produced); cursor++) for (let channel = 0; channel < this.channels; channel++) write(cursor, channel, this.carry[channel][cursor - this.carryStart])
      if (cursor >= end) return
    }
    if (this.produced !== cursor) this.seek(Math.floor(cursor / block) * block, inputAt, read, transposeAt)
    while (cursor < end) {
      const start = this.produced!
      const target = Math.round(inputAt(start + block + this.outputLatency) + this.inputLatency)
      const count = Math.max(0, Math.min(this.bufferLength, target - this.fed))
      this.module._setTransposeFactor(transposeAt(start), TONALITY_LIMIT_HZ / this.rate)
      if (count) read(this.fed, count, Array.from({ length: this.channels }, (_, channel) => this.plane(this.inputPointer, channel, count)))
      this.module._process(count, block)
      // 只按目标前进：超出缓冲的部分（极端速度）跳过，下一块从目标位置继续。
      this.fed = Math.max(this.fed + count, target)
      for (let channel = 0; channel < this.channels; channel++) this.carry[channel].set(this.plane(this.outputPointer, channel, block))
      this.carryStart = start; this.produced = start + block
      for (let sample = Math.max(cursor, start); sample < Math.min(end, this.produced); sample++) for (let channel = 0; channel < this.channels; channel++) write(sample, channel, this.carry[channel][sample - start])
      cursor = Math.min(end, this.produced)
    }
  }
  /** 在网格块 `start` 重新定位：送入以目标输入位置结尾的一整段历史，之后第一块输出就是 `start` 处的声音。 */
  private seek(start: number, inputAt: VideoEditStretchInputAt, read: VideoEditStretchInputRead, transposeAt: (sequenceSample: number) => number): void {
    this.module._reset()
    const position = Math.round(inputAt(start + this.outputLatency) + this.inputLatency)
    const step = Math.abs(inputAt(start + this.outputLatency + VIDEO_EDIT_STRETCH_BLOCK) - inputAt(start + this.outputLatency)) / VIDEO_EDIT_STRETCH_BLOCK
    const count = this.bufferLength
    read(position - count, count, Array.from({ length: this.channels }, (_, channel) => this.plane(this.inputPointer, channel, count)))
    this.module._setTransposeFactor(transposeAt(start), TONALITY_LIMIT_HZ / this.rate)
    this.module._seek(count, Math.max(1e-3, step))
    this.fed = position; this.produced = start; this.carryStart = Number.NaN
  }
}

/** 把若干源缓冲（声道映射的各个流）按输入坐标读出来的读取器；输入坐标 u = 方向 × 源样本号。 */
export function videoEditStretchBufferReader(buffers: readonly VideoEditSourceBuffer[], direction: 1 | -1): VideoEditStretchInputRead {
  return (from, count, planes) => {
    for (const plane of planes) plane.fill(0, 0, count)
    for (const buffer of buffers) for (let channel = 0; channel < planes.length; channel++) {
      const source = buffer.planes[channel]; const target = planes[channel]
      for (let index = 0; index < count; index++) {
        const at = direction * (from + index) - buffer.start
        if (at >= 0 && at < source.length) target[index] += source[at]
      }
    }
  }
}

export interface VideoEditStretchedSoundRequest extends VideoEditRetimedSoundRequest {
  stretcher: VideoEditTimeStretcher
  /** 变调（半音），0 不变。 */
  semitones: number
  /** true：保持音调（只拉伸时间）；false：磁带式，音调随局部速度升降。 */
  preservePitch: boolean
}
/** 片段在序列样本处的局部速度（源秒 / 序列秒，取正）。 */
function localSpeed(sourceAt: (sample: number) => number, sample: number, rate: number): number {
  return Math.abs(sourceAt(sample + VIDEO_EDIT_STRETCH_BLOCK) - sourceAt(sample)) * rate / VIDEO_EDIT_STRETCH_BLOCK
}
/** 把片段在 [from, to) 的声音经拉伸器加进 `targets`（与 `mixVideoEditRetimedSound` 同一请求约定）。 */
export async function mixVideoEditStretchedSound(request: VideoEditStretchedSoundRequest): Promise<void> {
  const { clip, fps, rate, from, to, base, targets, stretcher } = request
  const length = targets[0].length
  const first = Math.max(0, Math.ceil((from - base / rate) * rate - 1e-7)); const end = Math.min(length, Math.ceil((to - base / rate) * rate - 1e-7))
  if (first >= end) return
  const sourceAt = (sequenceSample: number): number => videoEditClipSourceSecondsAtTime(clip, sequenceSample / rate, fps)
  const direction: 1 | -1 = clip.reverse ? -1 : 1
  // 本次可能用到的源范围：网格块起点、两端延迟与重新定位的整段历史，各留余量。
  const grid = Math.floor((base + first) / VIDEO_EDIT_STRETCH_BLOCK) * VIDEO_EDIT_STRETCH_BLOCK
  const lead = stretcher.outputLatency + VIDEO_EDIT_STRETCH_BLOCK * 2
  const edges = [sourceAt(grid), sourceAt(base + end + lead)]
  const history = (stretcher.inputLatency + stretcher.outputLatency + VIDEO_EDIT_STRETCH_BLOCK * VIDEO_EDIT_PITCH_STRETCH_MAX * 2) / rate
  const buffers: VideoEditSourceBuffer[] = []
  for (const read of request.reads) {
    const buffer = await readVideoEditSourceBuffer(read.audio, Math.min(...edges) - history - 0.01, Math.max(...edges) + history + 0.01, rate, request.channels, read.gains)
    if (buffer) buffers.push(buffer)
  }
  const sourceRate = buffers[0]?.rate ?? rate
  if (stretcher.sourceRate !== sourceRate) { stretcher.invalidate(); stretcher.sourceRate = sourceRate }
  const pitch = 2 ** (request.semitones / 12)
  stretcher.render(base + first, end - first, sample => direction * sourceAt(sample) * sourceRate, videoEditStretchBufferReader(buffers, direction),
    sample => sourceRate / rate * pitch * (request.preservePitch ? 1 : localSpeed(sourceAt, sample, rate)),
    (sample, channel, value) => { const index = sample - base; const gain = request.gainAt(index); if (gain) targets[channel][index] += value * gain })
}
