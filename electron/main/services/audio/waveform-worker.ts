import { parentPort } from 'node:worker_threads'
import type { WaveformPyramidData, WaveformPyramidFloats, WaveformPyramidLevel } from '../../../../src/core/media/waveformPyramid'
import type { AudioWaveformAggregationOptions, AudioWaveformPyramidOptions, AudioWaveformPyramidOutput, AudioWaveformWorkerRequest, AudioWaveformChannel } from './types'

// 本文件作为独立 Worker 入口运行（测试中直接以 .ts 启动），只允许类型导入，不得有运行时导入。

const MAX_CHUNK_BYTES = 1024 * 1024
const MAX_KEPT_FRAMES = 1 << 22
const QUANT = 65535
const RANGE_QUANT = 32767

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

/** 一级的未量化摘要：每声道每桶的最小、最大值（32 位）与平方和（64 位）。 */
interface FloatLevel { samplesPerBucket: number; minima: Float32Array[]; maxima: Float32Array[]; sums: Float64Array[] }

function emptyFloatLevel(outputs: number, samplesPerBucket: number, count: number): FloatLevel {
  return {
    samplesPerBucket,
    minima: Array.from({ length: outputs }, () => new Float32Array(count).fill(Infinity)),
    maxima: Array.from({ length: outputs }, () => new Float32Array(count).fill(-Infinity)),
    sums: Array.from({ length: outputs }, () => new Float64Array(count)),
  }
}

/**
 * 第 0 级逐帧累加：values 是从绝对帧 startFrame 起的交织采样，target 的第 0 个桶是绝对桶 firstBucket，只累加到 endFrame 之前。
 * 平方和按 64 位逐帧累加并跨调用保留，结果与解码分块、整段或按段处理无关。返回实际累加的帧数。
 */
function accumulateBase(target: FloatLevel, firstBucket: number, values: Float32Array, startFrame: number, channels: number, mix: boolean, endFrame: number): number {
  const base = target.samplesPerBucket
  const frames = values.length / channels
  let index = 0, frame = startFrame
  while (index < frames && frame < endFrame) {
    const bucket = Math.floor(frame / base)
    const local = bucket - firstBucket
    const count = Math.min(frames - index, Math.min(endFrame, (bucket + 1) * base) - frame)
    for (let channel = 0; channel < channels; channel++) {
      let low = target.minima[channel][local]; let high = target.maxima[channel][local]; let sum = target.sums[channel][local]
      for (let offset = (index * channels) + channel, end = offset + count * channels; offset < end; offset += channels) {
        const value = values[offset]
        assertFinite(value)
        if (value < low) low = value
        if (value > high) high = value
        sum += value * value
      }
      target.minima[channel][local] = low; target.maxima[channel][local] = high; target.sums[channel][local] = sum
    }
    if (mix) {
      let low = target.minima[channels][local]; let high = target.maxima[channels][local]; let sum = target.sums[channels][local]
      for (let at = index; at < index + count; at++) {
        let value = 0
        for (let channel = 0; channel < channels; channel++) value += values[at * channels + channel]
        value /= channels
        if (value < low) low = value
        if (value > high) high = value
        sum += value * value
      }
      target.minima[channels][local] = low; target.maxima[channels][local] = high; target.sums[channels][local] = sum
    }
    index += count; frame += count
  }
  return frame - startFrame
}

/** 解码缺失的尾帧属于静音：从第一个缺帧的桶起把零纳入范围（只动确实缺帧的桶，单极性声音不被拉到零）。 */
function includeMissingTail(level: FloatLevel, firstBucket: number, deliveredFrames: number): void {
  const from = Math.max(0, Math.floor(deliveredFrames / level.samplesPerBucket) - firstBucket)
  for (let output = 0; output < level.minima.length; output++) for (let bucket = from; bucket < level.minima[output].length; bucket++) {
    level.minima[output][bucket] = Math.min(0, level.minima[output][bucket])
    level.maxima[output][bucket] = Math.max(0, level.maxima[output][bucket])
  }
}

/** 上一级：每 factor 个桶合并成一个（最小/最大取极值，平方和按桶序累加）；below 的第 0 个桶须对齐到 factor。 */
function aggregateFloatLevel(below: FloatLevel, factor: number, count: number): FloatLevel {
  const level = emptyFloatLevel(below.minima.length, below.samplesPerBucket * factor, count)
  for (let output = 0; output < below.minima.length; output++) {
    const minima = below.minima[output], maxima = below.maxima[output], sums = below.sums[output]
    for (let bucket = 0; bucket < minima.length; bucket++) {
      const parent = Math.floor(bucket / factor)
      if (parent >= count) break
      level.minima[output][parent] = Math.min(level.minima[output][parent], minima[bucket])
      level.maxima[output][parent] = Math.max(level.maxima[output][parent], maxima[bucket])
      level.sums[output][parent] += sums[bucket]
    }
  }
  return level
}

function peakOf(level: FloatLevel): number {
  let peak = 0
  for (let output = 0; output < level.minima.length; output++) for (let bucket = 0; bucket < level.minima[output].length; bucket++) peak = Math.max(peak, Math.abs(level.minima[output][bucket]), Math.abs(level.maxima[output][bucket]))
  return peak
}

/** 按全段比例定点：rms 用每桶实际帧数（最后一桶可能不满）。 */
function quantizer(amplitudeScale: number, expectedFrames: number) {
  const rangeOf = (value: number): number => Math.max(-RANGE_QUANT, Math.min(RANGE_QUANT, Math.round(value / amplitudeScale * RANGE_QUANT)))
  const rmsOf = (sum: number, samplesPerBucket: number, bucket: number, buckets: number): number => {
    const counted = bucket === buckets - 1 ? expectedFrames - bucket * samplesPerBucket : samplesPerBucket
    return Math.min(QUANT, Math.round(Math.sqrt(sum / counted) / amplitudeScale * QUANT))
  }
  return { rangeOf, rmsOf }
}

/** 第 1 级往上的各级：由第 1 级的未量化摘要逐级合并、定点。整段生成与按块派生共用，结果逐字节相同。 */
function levelsAbove(first: FloatLevel, options: AudioWaveformPyramidOptions, amplitudeScale: number): { floats: FloatLevel[]; levels: WaveformPyramidLevel[] } {
  const { expectedFrames, levelFactor, topBuckets } = options
  const floats = [first]
  while (floats.at(-1)!.minima[0].length > topBuckets) {
    const below = floats.at(-1)!
    floats.push(aggregateFloatLevel(below, levelFactor, Math.ceil(expectedFrames / (below.samplesPerBucket * levelFactor))))
  }
  return { floats, levels: floats.map(level => quantizeFloatLevel(level, amplitudeScale, expectedFrames)) }
}

function quantizeFloatLevel(level: FloatLevel, amplitudeScale: number, expectedFrames: number): WaveformPyramidLevel {
  const { rangeOf, rmsOf } = quantizer(amplitudeScale, expectedFrames)
  const bucketCount = level.minima[0].length
  return {
    samplesPerBucket: level.samplesPerBucket, bucketCount,
    min: level.minima.map((values) => Int16Array.from(values, rangeOf)),
    max: level.maxima.map((values) => Int16Array.from(values, rangeOf)),
    rms: level.sums.map((values) => Uint16Array.from(values, (sum, bucket) => rmsOf(sum, level.samplesPerBucket, bucket, bucketCount))),
  }
}

function validatePyramidOptions(options: AudioWaveformPyramidOptions): void {
  if (!Number.isInteger(options.channels) || options.channels < 1 || options.channels > 64
    || !Number.isSafeInteger(options.expectedFrames) || options.expectedFrames < 1
    || !Number.isInteger(options.baseSamplesPerBucket) || options.baseSamplesPerBucket < 1
    || !Number.isInteger(options.levelFactor) || options.levelFactor < 2 || !Number.isInteger(options.topBuckets) || options.topBuckets < 1
    || !Number.isInteger(options.sampleRate) || options.sampleRate < 1) throw new Error('无效的波形聚合规格。')
}

/**
 * 整段多级范围的唯一生成实现：第 0 级逐采样聚合，上级由下级按整数倍合并（最小/最大值与平方和），
 * 最后按全段最大峰值定点为 16 位。帧位置从 0 起与绝对时钟对齐，未到达的帧视为静音。
 * keepFloats 时另交出第 1 级的未量化摘要：之后这份声音只改了几段时，按块派生不必再整段解码（deriveWaveformPyramid）。
 */
export class AudioWaveformPyramidBuilder {
  private readonly options: AudioWaveformPyramidOptions
  private readonly base: FloatLevel
  private readonly reader: FrameReader
  private frame = 0
  constructor(options: AudioWaveformPyramidOptions) {
    validatePyramidOptions(options)
    this.options = options
    this.base = emptyFloatLevel(options.channels + (options.mix ? 1 : 0), options.baseSamplesPerBucket, Math.ceil(options.expectedFrames / options.baseSamplesPerBucket))
    this.reader = new FrameReader(4 * options.channels)
  }
  push(bytes: Uint8Array): void {
    const values = this.reader.read(bytes)
    this.frame += accumulateBase(this.base, 0, values, this.frame, this.options.channels, this.options.mix, this.options.expectedFrames)
  }
  finish(): AudioWaveformPyramidOutput {
    if (!this.reader.complete) throw new Error('音频采样流在不完整帧处结束。')
    const { expectedFrames, levelFactor, topBuckets } = this.options
    if (this.frame < expectedFrames) includeMissingTail(this.base, 0, this.frame)
    const peakMax = peakOf(this.base)
    const amplitudeScale = Math.max(1, peakMax)
    const baseLevel = quantizeFloatLevel(this.base, amplitudeScale, expectedFrames)
    const above = this.base.minima[0].length > topBuckets
      ? levelsAbove(aggregateFloatLevel(this.base, levelFactor, Math.ceil(expectedFrames / (this.base.samplesPerBucket * levelFactor))), this.options, amplitudeScale)
      : { floats: [], levels: [] }
    const top = above.floats.at(-1) ?? this.base
    const topCount = top.minima[0].length
    const counted = (bucket: number): number => bucket === topCount - 1 ? expectedFrames - bucket * top.samplesPerBucket : top.samplesPerBucket
    const channels = Array.from({ length: this.options.channels }, (_, channel) => ({
      peak: Array.from(top.minima[channel], (value, bucket) => Math.max(Math.abs(value), Math.abs(top.maxima[channel][bucket]))),
      rms: Array.from(top.sums[channel], (sum, bucket) => Math.sqrt(sum / counted(bucket))),
      sampleCounts: Array.from({ length: topCount }, (_, bucket) => counted(bucket)),
    }))
    const pyramid: WaveformPyramidData = {
      sampleRate: this.options.sampleRate, frameCount: expectedFrames, startSeconds: this.options.startSeconds, endSeconds: this.options.endSeconds,
      amplitudeScale, peakMax, channelCount: this.base.minima.length, nativeChannels: this.options.nativeChannels, mixChannel: this.options.mix, levels: [baseLevel, ...above.levels],
    }
    const first = above.floats[0]
    return { channels, pyramid, ...(this.options.keepFloats && first ? { floats: toPyramidFloats(first) } : {}) }
  }
}

function toPyramidFloats(level: FloatLevel): WaveformPyramidFloats {
  return { samplesPerBucket: level.samplesPerBucket, bucketCount: level.minima[0].length, minima: level.minima, maxima: level.maxima, sums: level.sums }
}

/**
 * 按块派生：parent 是上一版声音的金字塔、parentFloats 是它第 1 级的未量化摘要；spans 是改动所在、对齐到第 1 级桶边界的帧段，
 * 带着新声音这些帧的采样（解码只到 deliveredFrames，之后按缺帧处理）。只重算这些桶的第 0、1 级，其余从 parent 复制，
 * 第 1 级往上由摘要整体重合并——与对新声音整段生成逐字节相同（摘要也相同，可以继续往下派生）。
 * 两版长度不同（补录拼接）时，spans 必须盖住从较短长度所在的第 1 级桶到新结尾的整段：之前的桶原样复制，之后全部重算。
 * 全段峰值变了（定点比例变了）时无法沿用 parent 的第 0 级，返回原因，由调用方整段生成。
 */
export function deriveWaveformPyramid(parent: WaveformPyramidData, parentFloats: WaveformPyramidFloats, options: AudioWaveformPyramidOptions, spans: ReadonlyArray<{ startFrame: number; endFrame: number; values: Float32Array }>, deliveredFrames: number): { pyramid: WaveformPyramidData; floats: WaveformPyramidFloats } | { reason: string } {
  const derivation = WaveformPyramidDerivation.start(parent, parentFloats, options, deliveredFrames)
  if ('reason' in derivation) return derivation
  for (const part of spans) {
    const reason = derivation.add(part)
    if (reason) return { reason }
  }
  return derivation.finish()
}

/**
 * 按块派生的逐段形态：重算段可以分成多块依次交进来（每块起止对齐到第 1 级桶，最后一块可以止于结尾），
 * 读一块算一块，内存与重算总长无关。规则与结果同 deriveWaveformPyramid。
 */
export class WaveformPyramidDerivation {
  private readonly changed: Array<{ firstBucket: number; level: FloatLevel }> = []
  private readonly covered: Array<[number, number]> = []
  private readonly parent: WaveformPyramidData
  private readonly options: AudioWaveformPyramidOptions
  private readonly first: FloatLevel
  /** 父金字塔里这一帧之前的桶原样沿用；长度不同时它之后整段都要交进来重算。 */
  private readonly kept: number
  private readonly deliveredFrames: number
  // 本文件也作为 Worker 直接以 .ts 运行（只剥类型），不能用构造参数属性。
  private constructor(parent: WaveformPyramidData, options: AudioWaveformPyramidOptions, first: FloatLevel, kept: number, deliveredFrames: number) {
    this.parent = parent; this.options = options; this.first = first; this.kept = kept; this.deliveredFrames = deliveredFrames
  }
  static start(parent: WaveformPyramidData, parentFloats: WaveformPyramidFloats, options: AudioWaveformPyramidOptions, deliveredFrames: number): WaveformPyramidDerivation | { reason: string } {
    validatePyramidOptions(options)
    const { expectedFrames, baseSamplesPerBucket: base, levelFactor, channels, mix } = options
    const outputs = channels + (mix ? 1 : 0)
    const span = base * levelFactor
    if (parent.levels.length < 2 || parent.channelCount !== outputs || parent.mixChannel !== mix || parent.levels[0].samplesPerBucket !== base
      || parentFloats.samplesPerBucket !== span || parentFloats.bucketCount !== parent.levels[1].bucketCount || parentFloats.minima.length !== outputs) return { reason: '上一版波形的规格不同' }
    // 整段生成在第 0 级不超过顶级桶数时不建上面各级（也不留摘要），派生不能凭空多出一级。
    if (Math.ceil(expectedFrames / base) <= options.topBuckets) return { reason: '声音太短，没有第 1 级' }
    const kept = parent.frameCount === expectedFrames ? expectedFrames : Math.floor(Math.min(parent.frameCount, expectedFrames) / span) * span
    const firstCount = Math.ceil(expectedFrames / span)
    const copy = <T extends Float32Array | Float64Array>(values: T, empty: T): T => { empty.set(values.subarray(0, Math.min(Math.ceil(kept / span), firstCount))); return empty }
    return new WaveformPyramidDerivation(parent, options, {
      samplesPerBucket: span,
      minima: parentFloats.minima.map(values => copy(values, new Float32Array(firstCount).fill(Infinity))),
      maxima: parentFloats.maxima.map(values => copy(values, new Float32Array(firstCount).fill(-Infinity))),
      sums: parentFloats.sums.map(values => copy(values, new Float64Array(firstCount))),
    }, kept, deliveredFrames)
  }
  /** 交进一块要重算的帧（带新声音这些帧的采样）；不合规时返回原因。 */
  add(part: { startFrame: number; endFrame: number; values: Float32Array }): string | undefined {
    const { expectedFrames, baseSamplesPerBucket: base, levelFactor, channels, mix } = this.options
    const span = base * levelFactor
    if (part.startFrame % span || part.endFrame <= part.startFrame || (part.endFrame % span && part.endFrame !== expectedFrames) || part.endFrame > expectedFrames) return '派生段没有对齐'
    const firstBucket = part.startFrame / base
    const level = emptyFloatLevel(this.first.minima.length, base, Math.ceil(part.endFrame / base) - firstBucket)
    const delivered = Math.min(this.deliveredFrames, part.endFrame)
    if (accumulateBase(level, firstBucket, part.values, part.startFrame, channels, mix, delivered) !== Math.max(0, delivered - part.startFrame)) return '派生段采样不足'
    if (delivered < part.endFrame) includeMissingTail(level, firstBucket, this.deliveredFrames)
    const above = aggregateFloatLevel(level, levelFactor, Math.ceil((part.endFrame - part.startFrame) / span))
    const at = part.startFrame / span
    for (let output = 0; output < this.first.minima.length; output++) {
      this.first.minima[output].set(above.minima[output], at); this.first.maxima[output].set(above.maxima[output], at); this.first.sums[output].set(above.sums[output], at)
    }
    this.changed.push({ firstBucket, level })
    this.covered.push([part.startFrame, part.endFrame])
    return undefined
  }
  finish(): { pyramid: WaveformPyramidData; floats: WaveformPyramidFloats } | { reason: string } {
    const { expectedFrames, baseSamplesPerBucket: base } = this.options
    let reach = this.kept
    for (const [start, end] of [...this.covered].sort((a, b) => a[0] - b[0])) if (start <= reach) reach = Math.max(reach, end)
    if (reach < expectedFrames) return { reason: '长度变了但派生段没有盖住尾部' }
    const peakMax = peakOf(this.first)
    const amplitudeScale = Math.max(1, peakMax)
    if (amplitudeScale !== this.parent.amplitudeScale) return { reason: '全段峰值超过满幅且变了，定点比例不同' }
    const baseLevel = this.parent.levels[0]
    const bucketCount = Math.ceil(expectedFrames / base)
    const keptBuckets = Math.min(Math.ceil(this.kept / base), bucketCount)
    const copy = <T extends Int16Array | Uint16Array>(values: T, empty: T): T => { empty.set(values.subarray(0, keptBuckets)); return empty }
    const patched: WaveformPyramidLevel = { samplesPerBucket: base, bucketCount,
      min: baseLevel.min.map(values => copy(values, new Int16Array(bucketCount))), max: baseLevel.max.map(values => copy(values, new Int16Array(bucketCount))), rms: baseLevel.rms.map(values => copy(values, new Uint16Array(bucketCount))) }
    const { rangeOf, rmsOf } = quantizer(amplitudeScale, expectedFrames)
    for (const { firstBucket, level } of this.changed) for (let output = 0; output < level.minima.length; output++) for (let local = 0; local < level.minima[output].length; local++) {
      const bucket = firstBucket + local
      patched.min[output][bucket] = rangeOf(level.minima[output][local])
      patched.max[output][bucket] = rangeOf(level.maxima[output][local])
      patched.rms[output][bucket] = rmsOf(level.sums[output][local], base, bucket, bucketCount)
    }
    const above = levelsAbove(this.first, this.options, amplitudeScale)
    return {
      pyramid: { ...this.parent, frameCount: expectedFrames, startSeconds: this.options.startSeconds, endSeconds: this.options.endSeconds, peakMax, amplitudeScale, levels: [patched, ...above.levels] },
      floats: toPyramidFloats(this.first),
    }
  }
}

function transferables(output: AudioWaveformChannel[] | AudioWaveformPyramidOutput): ArrayBuffer[] {
  if (Array.isArray(output)) return output.flatMap((channel) => channel.samples ? [channel.samples.buffer as ArrayBuffer] : [])
  const floats = output.floats ? [...output.floats.minima, ...output.floats.maxima, ...output.floats.sums].map((values) => values.buffer as ArrayBuffer) : []
  return [...output.pyramid.levels.flatMap((level) => [...level.min, ...level.max, ...level.rms].map((values) => values.buffer as ArrayBuffer)), ...floats]
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
      const reply = Array.isArray(output) ? { channels: output } : { channels: output.channels, pyramid: output.pyramid, ...(output.floats ? { floats: output.floats } : {}) }
      port.postMessage({ id: request.id, ok: true, ...reply }, transferables(output))
    } catch (error) {
      port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
