import { videoEditClipSourceSecondsAtTime, videoEditClipSpeedValue, type VideoEditClipTiming } from '@/core/videoEdit/clipSpeed'
import { videoEditDefaultAudioGains } from '@/core/videoEdit/audioChannels'
import type { VideoEditAudioChunk, VideoEditClipAudio } from './videoEditFrameSource'

/**
 * 变速与倒放片段的声音（4.13）。
 *
 * - 每个输出样本的源位置只由它在序列上的绝对时间决定（`videoEditClipSourceSecondsAtTime`，唯一换算入口），
 *   读出覆盖这一块所需的连续源样本后，用加窗 sinc 在该位置插值：没有跨块状态，任何分块方式下逐样本一致，延迟为 0。
 *   预览与导出走同一个混音函数，所以结果相同。
 * - 加速时截止频率按每个输出样本走过的源样本数降低（抗混叠）；核宽度上限 32 个源样本（400% 以上只部分抗混叠，
 *   听感上那时已是快进音）。速度 100% 且位置落在整数样本上时结果就是原样本。
 * - “保持音调”不在这里：重采样后的声音音调随速度升降，由混音在效果链最前面加一级音调补偿
 *   （`VideoEditAudioEffectChain` 的 smbPitchShift 相位声码器，比例 1/速度，固定延迟，与 4.7c 同一套连续性与预读规则）。
 */
const KERNEL_ZEROS = 8
const MAX_HALF_WIDTH = 32

/** 每个输出样本走过多少个源样本时的插值半宽与截止（相对源奈奎斯特）。 */
export function videoEditResampleKernel(step: number): { cutoff: number; halfWidth: number } {
  const cutoff = Math.min(1, 1 / Math.max(step, 1e-9))
  return { cutoff, halfWidth: Math.min(MAX_HALF_WIDTH, Math.ceil(KERNEL_ZEROS / cutoff)) }
}
/**
 * `plane` 在位置 `index + fraction` 的值（加窗 sinc，权重归一化；越界样本按静音）。整数部分与小数部分分开传：
 * 小数部分由绝对源位置算出，与缓冲从哪里开始无关，分块不同也得到同一结果。
 */
export function videoEditResampleAt(plane: Float32Array, index: number, fraction: number, cutoff: number, halfWidth: number): number {
  const first = Math.ceil(fraction - halfWidth); const last = Math.floor(fraction + halfWidth)
  let sum = 0; let weights = 0
  for (let tap = first; tap <= last; tap++) {
    const distance = fraction - tap
    const x = Math.PI * cutoff * distance
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x
    const weight = sinc * (0.5 + 0.5 * Math.cos(Math.PI * distance / halfWidth))
    weights += weight
    const at = index + tap
    if (at >= 0 && at < plane.length) sum += plane[at] * weight
  }
  return weights > 1e-9 ? sum / weights : 0
}

/** `start` 是缓冲第 0 个样本的绝对源样本号（源时间 × 采样率）。 */
interface SourceBuffer { start: number; rate: number; planes: Float32Array[] }
/**
 * 把 [from, to) 秒的源声音读成连续缓冲（已按声道映射混到输出声道）。缓冲以第一块的时间戳为原点；后续块按各自时间戳落位，
 * 块之间的空隙为静音。读取器的块落在同一采样网格上，所以缓冲原点不同的两次读取对同一源时刻给出同一样本。
 */
async function readSourceBuffer(audio: VideoEditClipAudio, from: number, to: number, rate: number, outputs: number, gains?: number[][]): Promise<SourceBuffer | undefined> {
  const blocks: Array<{ timestamp: number; sampleRate: number; planes: Float32Array[] }> = []
  for await (const chunk of audio.chunks(Math.max(0, from), to, rate)) {
    try { blocks.push({ timestamp: chunk.timestamp, sampleRate: chunk.sampleRate, planes: mapped(chunk, outputs, gains ?? videoEditDefaultAudioGains(chunk.numberOfChannels, outputs)) }) }
    finally { chunk.close() }
  }
  if (!blocks.length) return undefined
  const start = blocks[0].timestamp; const bufferRate = blocks[0].sampleRate
  const last = blocks[blocks.length - 1]
  const length = Math.max(1, Math.round((last.timestamp - start) * bufferRate + last.planes[0].length * bufferRate / last.sampleRate) + 1)
  const planes = Array.from({ length: outputs }, () => new Float32Array(length))
  for (const block of blocks) {
    for (let channel = 0; channel < outputs; channel++) {
      const source = block.planes[channel]; const target = planes[channel]
      if (block.sampleRate === bufferRate) {
        const offset = Math.round((block.timestamp - start) * bufferRate)
        for (let index = 0; index < source.length; index++) { const at = offset + index; if (at >= 0 && at < length) target[at] = source[index] }
      } else for (let index = 0; index < source.length; index++) {
        const at = Math.round((block.timestamp + index / block.sampleRate - start) * bufferRate)
        if (at >= 0 && at < length) target[at] = source[index]
      }
    }
  }
  return { start: Math.round(start * bufferRate), rate: bufferRate, planes }
}
function mapped(chunk: VideoEditAudioChunk, outputs: number, gains: number[][]): Float32Array[] {
  const inputs: Float32Array[] = []
  const plane = (index: number): Float32Array => {
    if (!inputs[index]) { inputs[index] = new Float32Array(chunk.numberOfFrames); chunk.copyTo(inputs[index], { planeIndex: index, format: 'f32-planar' }) }
    return inputs[index]
  }
  return Array.from({ length: outputs }, (_, output) => {
    const data = new Float32Array(chunk.numberOfFrames); const row = gains[output] ?? []
    for (let input = 0; input < Math.min(row.length, chunk.numberOfChannels); input++) {
      const gain = row[input]; if (!gain) continue
      const values = plane(input)
      for (let index = 0; index < data.length; index++) data[index] += values[index] * gain
    }
    return data
  })
}

export interface VideoEditRetimedSoundRequest {
  clip: VideoEditClipTiming
  fps: number
  /** 序列采样率与声道数。 */
  rate: number
  channels: number
  /** 只写序列时间 [from, to) 秒内的样本；`targets` 的第 0 个样本是序列样本 `base`。 */
  from: number
  to: number
  base: number
  targets: Float32Array[]
  gainAt: (sample: number) => number
  /** 本片段要读的声音流（声道映射的每个流一项；没有映射时一项、`gains` 缺省按默认声道对应）。 */
  reads: ReadonlyArray<{ audio: VideoEditClipAudio; gains?: number[][] }>
}
/** 把变速／倒放片段在 [from, to) 的声音按位置重采样后加进 `targets`。 */
export async function mixVideoEditRetimedSound(request: VideoEditRetimedSoundRequest): Promise<void> {
  const { clip, fps, rate, from, to, base, targets } = request
  const length = targets[0].length
  const first = Math.max(0, Math.ceil((from - base / rate) * rate - 1e-7)); const end = Math.min(length, Math.ceil((to - base / rate) * rate - 1e-7))
  if (first >= end) return
  const sourceAt = (sample: number): number => videoEditClipSourceSecondsAtTime(clip, (base + sample) / rate, fps)
  const edges = [sourceAt(first), sourceAt(end - 1)]
  const speed = videoEditClipSpeedValue(clip)
  for (const read of request.reads) {
    // 读取范围两端各留插值核的余量（按最低 8 kHz 源采样率估算，宁多勿少）。
    const margin = (MAX_HALF_WIDTH + 4) / 8000 + speed / rate
    const buffer = await readSourceBuffer(read.audio, Math.min(...edges) - margin, Math.max(...edges) + margin, rate, request.channels, read.gains)
    if (!buffer) continue
    const { cutoff, halfWidth } = videoEditResampleKernel(speed * buffer.rate / rate)
    for (let sample = first; sample < end; sample++) {
      const position = sourceAt(sample) * buffer.rate
      const whole = Math.floor(position); const fraction = position - whole
      const gain = request.gainAt(sample)
      if (!gain) continue
      for (let channel = 0; channel < targets.length; channel++) targets[channel][sample] += videoEditResampleAt(buffer.planes[channel], whole - buffer.start, fraction, cutoff, halfWidth) * gain
    }
  }
}
