import { parentPort } from 'node:worker_threads'
import type { AudioWaveformAggregationOptions, AudioWaveformWorkerRequest, AudioWaveformChannel } from './types'

/** The sole PCM aggregation implementation; production runs it in a Node Worker. */
export class AudioWaveformAggregator {
  private readonly sums: Float64Array[]
  private readonly peaks: Float64Array[]
  private readonly counts: Uint32Array[]
  private remainder = new Uint8Array(0)
  private frame = 0
  private readonly options: AudioWaveformAggregationOptions
  constructor(options: AudioWaveformAggregationOptions) {
    this.options = options
    if (!Number.isInteger(options.bucketCount) || options.bucketCount < 1 || options.bucketCount > 360_000
      || !Number.isSafeInteger(options.expectedFrames) || options.expectedFrames < 1
      || (options.channels !== 1 && options.channels !== 2) || !['s16le', 'f32le'].includes(options.format)) throw new Error('无效的波形聚合规格。')
    this.sums = Array.from({ length: options.channels }, () => new Float64Array(options.bucketCount))
    this.peaks = Array.from({ length: options.channels }, () => new Float64Array(options.bucketCount))
    this.counts = Array.from({ length: options.channels }, () => new Uint32Array(options.bucketCount))
  }
  push(bytes: Uint8Array): void {
    if (bytes.byteLength > 1024 * 1024) throw new Error('波形采样块超过资源上限。')
    const data = new Uint8Array(this.remainder.length + bytes.length)
    data.set(this.remainder); data.set(bytes, this.remainder.length)
    const sampleBytes = this.options.format === 's16le' ? 2 : 4
    const frameBytes = sampleBytes * this.options.channels
    const length = data.length - data.length % frameBytes
    const view = new DataView(data.buffer)
    for (let offset = 0; offset < length; offset += frameBytes, this.frame++) {
      const bucket = Math.min(this.options.bucketCount - 1, Math.floor(this.frame * this.options.bucketCount / this.options.expectedFrames))
      for (let channel = 0; channel < this.options.channels; channel++) {
        const value = this.options.format === 's16le'
          ? view.getInt16(offset + channel * sampleBytes, true) / 32768
          : view.getFloat32(offset + channel * sampleBytes, true)
        if (!Number.isFinite(value)) throw new Error('音频包含非有限采样值。')
        if (this.counts[channel][bucket] === 0xffff_ffff) throw new Error('音频采样数量超过资源上限。')
        this.sums[channel][bucket] += value * value
        this.peaks[channel][bucket] = Math.max(this.peaks[channel][bucket], Math.abs(value))
        this.counts[channel][bucket]++
      }
    }
    this.remainder = data.slice(length)
  }
  finish(): AudioWaveformChannel[] {
    if (this.remainder.length) throw new Error('音频采样流在不完整帧处结束。')
    return this.sums.map((sum, channel) => ({
      peak: Array.from(this.peaks[channel]),
      rms: Array.from(sum, (value, bucket) => this.counts[channel][bucket] ? Math.sqrt(value / this.counts[channel][bucket]) : 0),
      sampleCounts: Array.from(this.counts[channel]),
    }))
  }
}

const port = parentPort
if (port) {
  let aggregator: AudioWaveformAggregator | undefined
  port.on('message', (request: AudioWaveformWorkerRequest) => {
    try {
      if (request.type === 'start' && request.options && !aggregator) aggregator = new AudioWaveformAggregator(request.options)
      else if (request.type === 'chunk' && request.bytes && aggregator) aggregator.push(request.bytes)
      else if (request.type !== 'finish' || !aggregator) throw new Error('无效的波形 Worker 消息。')
      port.postMessage({ id: request.id, ok: true, ...(request.type === 'finish' ? { channels: aggregator?.finish() } : {}) })
    } catch (error) {
      port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
