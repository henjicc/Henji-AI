import { parentPort } from 'node:worker_threads'
import type { WaveformPyramidData, WaveformPyramidLevel } from '../../../../src/core/media/waveformPyramid'
import type { AudioWaveformAggregationOptions, AudioWaveformPyramidOptions, AudioWaveformPyramidOutput, AudioWaveformWorkerRequest, AudioWaveformChannel } from './types'

// 本文件作为独立 Worker 入口运行（测试中直接以 .ts 启动），只允许类型导入，不得有运行时导入。

const MAX_CHUNK_BYTES = 1024 * 1024
const MAX_KEPT_FRAMES = 1 << 22
const QUANT = 65535

/** 把可能未对齐或跨块的 f32le 字节流切成完整帧的 Float32Array。 */
class FrameReader {
  private remainder = new Uint8Array(0)
  private readonly frameBytes: number
  constructor(frameBytes: number) { this.frameBytes = frameBytes }
  read(bytes: Uint8Array): Float32Array {
    if (bytes.byteLength > MAX_CHUNK_BYTES) throw new Error('波形采样块超过资源上限。')
    let data: Uint8Array
    if (this.remainder.length) {
      data = new Uint8Array(this.remainder.length + bytes.length)
      data.set(this.remainder); data.set(bytes, this.remainder.length)
    } else data = bytes
    const usable = data.length - data.length % this.frameBytes
    this.remainder = data.slice(usable)
    const aligned = data.byteOffset % 4 === 0 ? data : data.slice(0, usable)
    return new Float32Array(aligned.buffer, aligned.byteOffset, usable / 4)
  }
  get complete(): boolean { return this.remainder.length === 0 }
}

function assertFinite(value: number): void {
  // NaN 与 ±Infinity 相减都不是 0。
  if (value - value !== 0) throw new Error('音频包含非有限采样值。')
}

/** 区间波形的唯一聚合实现：任意桶数，线性峰值/RMS/采样数，可选保留原始采样。 */
export class AudioWaveformAggregator {
  private readonly sums: Float64Array[]
  private readonly peaks: Float64Array[]
  private readonly counts: Uint32Array[]
  private readonly samples?: Float32Array[]
  private readonly reader: FrameReader
  private frame = 0
  private readonly options: AudioWaveformAggregationOptions
  constructor(options: AudioWaveformAggregationOptions) {
    this.options = options
    if (!Number.isInteger(options.bucketCount) || options.bucketCount < 1 || options.bucketCount > 360_000
      || !Number.isSafeInteger(options.expectedFrames) || options.expectedFrames < 1
      || (options.channels !== 1 && options.channels !== 2)
      || (options.keepSamples && options.expectedFrames > MAX_KEPT_FRAMES)) throw new Error('无效的波形聚合规格。')
    this.sums = Array.from({ length: options.channels }, () => new Float64Array(options.bucketCount))
    this.peaks = Array.from({ length: options.channels }, () => new Float64Array(options.bucketCount))
    this.counts = Array.from({ length: options.channels }, () => new Uint32Array(options.bucketCount))
    if (options.keepSamples) this.samples = Array.from({ length: options.channels }, () => new Float32Array(options.expectedFrames))
    this.reader = new FrameReader(4 * options.channels)
  }
  push(bytes: Uint8Array): void {
    const values = this.reader.read(bytes)
    const channels = this.options.channels
    for (let offset = 0; offset < values.length; offset += channels, this.frame++) {
      const bucket = Math.min(this.options.bucketCount - 1, Math.floor(this.frame * this.options.bucketCount / this.options.expectedFrames))
      for (let channel = 0; channel < channels; channel++) {
        const value = values[offset + channel]
        assertFinite(value)
        if (this.counts[channel][bucket] === 0xffff_ffff) throw new Error('音频采样数量超过资源上限。')
        this.sums[channel][bucket] += value * value
        this.peaks[channel][bucket] = Math.max(this.peaks[channel][bucket], Math.abs(value))
        this.counts[channel][bucket]++
        if (this.samples && this.frame < this.options.expectedFrames) this.samples[channel][this.frame] = value
      }
    }
  }
  finish(): AudioWaveformChannel[] {
    if (!this.reader.complete) throw new Error('音频采样流在不完整帧处结束。')
    return this.sums.map((sum, channel) => ({
      peak: Array.from(this.peaks[channel]),
      rms: Array.from(sum, (value, bucket) => this.counts[channel][bucket] ? Math.sqrt(value / this.counts[channel][bucket]) : 0),
      sampleCounts: Array.from(this.counts[channel]),
      ...(this.samples ? { samples: this.samples[channel] } : {}),
    }))
  }
}

/**
 * 整段多级峰值的唯一生成实现：第 0 级逐采样聚合，上级由下级按整数倍合并（峰值取最大、平方和相加），
 * 最后按全段最大峰值定点为 16 位。帧位置从 0 起与绝对时钟对齐，未到达的帧视为静音。
 */
export class AudioWaveformPyramidBuilder {
  private readonly options: AudioWaveformPyramidOptions
  private readonly outputs: number
  private readonly bucketCount: number
  private readonly peaks: Float32Array[]
  private readonly sums: Float32Array[]
  private readonly reader: FrameReader
  private frame = 0
  constructor(options: AudioWaveformPyramidOptions) {
    this.options = options
    if (!Number.isInteger(options.channels) || options.channels < 1 || options.channels > 64
      || !Number.isSafeInteger(options.expectedFrames) || options.expectedFrames < 1
      || !Number.isInteger(options.baseSamplesPerBucket) || options.baseSamplesPerBucket < 1
      || !Number.isInteger(options.levelFactor) || options.levelFactor < 2 || !Number.isInteger(options.topBuckets) || options.topBuckets < 1
      || !Number.isInteger(options.sampleRate) || options.sampleRate < 1) throw new Error('无效的波形聚合规格。')
    this.outputs = options.channels + (options.mix ? 1 : 0)
    this.bucketCount = Math.ceil(options.expectedFrames / options.baseSamplesPerBucket)
    this.peaks = Array.from({ length: this.outputs }, () => new Float32Array(this.bucketCount))
    this.sums = Array.from({ length: this.outputs }, () => new Float32Array(this.bucketCount))
    this.reader = new FrameReader(4 * options.channels)
  }
  push(bytes: Uint8Array): void {
    const values = this.reader.read(bytes)
    const { channels, expectedFrames, baseSamplesPerBucket: base, mix } = this.options
    const frames = values.length / channels
    let index = 0
    while (index < frames && this.frame < expectedFrames) {
      const bucket = Math.floor(this.frame / base)
      const count = Math.min(frames - index, Math.min(expectedFrames, (bucket + 1) * base) - this.frame)
      for (let channel = 0; channel < channels; channel++) {
        let peak = this.peaks[channel][bucket]; let sum = this.sums[channel][bucket]
        for (let offset = (index * channels) + channel, end = offset + count * channels; offset < end; offset += channels) {
          const value = values[offset]
          assertFinite(value)
          const magnitude = value < 0 ? -value : value
          if (magnitude > peak) peak = magnitude
          sum += value * value
        }
        this.peaks[channel][bucket] = peak; this.sums[channel][bucket] = sum
      }
      if (mix) {
        let peak = this.peaks[channels][bucket]; let sum = this.sums[channels][bucket]
        for (let frame = index; frame < index + count; frame++) {
          let value = 0
          for (let channel = 0; channel < channels; channel++) value += values[frame * channels + channel]
          value /= channels
          const magnitude = value < 0 ? -value : value
          if (magnitude > peak) peak = magnitude
          sum += value * value
        }
        this.peaks[channels][bucket] = peak; this.sums[channels][bucket] = sum
      }
      index += count; this.frame += count
    }
  }
  finish(): AudioWaveformPyramidOutput {
    if (!this.reader.complete) throw new Error('音频采样流在不完整帧处结束。')
    const { expectedFrames, baseSamplesPerBucket: base, levelFactor, topBuckets } = this.options
    let peakMax = 0
    for (const peaks of this.peaks) for (const value of peaks) if (value > peakMax) peakMax = value
    const amplitudeScale = Math.max(1, peakMax)
    const quantize = (value: number): number => Math.min(QUANT, Math.round(value / amplitudeScale * QUANT))
    // Linear float levels: each level's sums are aggregated from the one below.
    const floats: Array<{ samplesPerBucket: number; peaks: Float32Array[]; sums: Float32Array[] }> = [{ samplesPerBucket: base, peaks: this.peaks, sums: this.sums }]
    while (floats.at(-1)!.peaks[0].length > topBuckets) {
      const below = floats.at(-1)!
      const samplesPerBucket = below.samplesPerBucket * levelFactor
      const count = Math.ceil(expectedFrames / samplesPerBucket)
      const peaks = below.peaks.map((source) => {
        const target = new Float32Array(count)
        for (let bucket = 0; bucket < source.length; bucket++) { const parent = Math.floor(bucket / levelFactor); if (source[bucket] > target[parent]) target[parent] = source[bucket] }
        return target
      })
      const sums = below.sums.map((source) => {
        const target = new Float32Array(count)
        for (let bucket = 0; bucket < source.length; bucket++) target[Math.floor(bucket / levelFactor)] += source[bucket]
        return target
      })
      floats.push({ samplesPerBucket, peaks, sums })
    }
    const counted = (samplesPerBucket: number, bucket: number, buckets: number): number => bucket === buckets - 1 ? expectedFrames - bucket * samplesPerBucket : samplesPerBucket
    const levels: WaveformPyramidLevel[] = floats.map(({ samplesPerBucket, peaks, sums }) => {
      const bucketCount = peaks[0].length
      return {
        samplesPerBucket, bucketCount,
        peak: peaks.map((values) => Uint16Array.from(values, quantize)),
        rms: sums.map((values) => Uint16Array.from(values, (sum, bucket) => quantize(Math.sqrt(sum / counted(samplesPerBucket, bucket, bucketCount))))),
      }
    })
    const top = floats.at(-1)!
    const topCount = top.peaks[0].length
    const channels = Array.from({ length: this.options.channels }, (_, channel) => ({
      peak: Array.from(top.peaks[channel]),
      rms: Array.from(top.sums[channel], (sum, bucket) => Math.sqrt(sum / counted(top.samplesPerBucket, bucket, topCount))),
      sampleCounts: Array.from({ length: topCount }, (_, bucket) => counted(top.samplesPerBucket, bucket, topCount)),
    }))
    const pyramid: WaveformPyramidData = {
      sampleRate: this.options.sampleRate, frameCount: expectedFrames, startSeconds: this.options.startSeconds, endSeconds: this.options.endSeconds,
      amplitudeScale, peakMax, channelCount: this.outputs, nativeChannels: this.options.nativeChannels, mixChannel: this.options.mix, levels,
    }
    return { channels, pyramid }
  }
}

function transferables(output: AudioWaveformChannel[] | AudioWaveformPyramidOutput): ArrayBuffer[] {
  if (Array.isArray(output)) return output.flatMap((channel) => channel.samples ? [channel.samples.buffer as ArrayBuffer] : [])
  return output.pyramid.levels.flatMap((level) => [...level.peak, ...level.rms].map((values) => values.buffer as ArrayBuffer))
}

const port = parentPort
if (port) {
  let aggregator: AudioWaveformAggregator | AudioWaveformPyramidBuilder | undefined
  port.on('message', (request: AudioWaveformWorkerRequest) => {
    try {
      if (request.type === 'start' && request.options && !aggregator) {
        aggregator = request.options.kind === 'pyramid' ? new AudioWaveformPyramidBuilder(request.options) : new AudioWaveformAggregator(request.options)
      } else if (request.type === 'chunk' && request.bytes && aggregator) aggregator.push(request.bytes)
      else if (request.type !== 'finish' || !aggregator) throw new Error('无效的波形 Worker 消息。')
      if (request.type !== 'finish') { port.postMessage({ id: request.id, ok: true }); return }
      const output = aggregator.finish()
      const reply = Array.isArray(output) ? { channels: output } : { channels: output.channels, pyramid: output.pyramid }
      port.postMessage({ id: request.id, ok: true, ...reply }, transferables(output))
    } catch (error) {
      port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
