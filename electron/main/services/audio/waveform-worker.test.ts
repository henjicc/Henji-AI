import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { AudioWaveformAggregator, AudioWaveformPyramidBuilder, deriveWaveformPyramid } from './waveform-worker'
import { AudioWaveformWorker } from './worker-client'
import { aggregateWaveformLevel, aggregateWaveformLevelRange, aggregateWaveformSampleRange, decodeWaveformPyramid, encodeWaveformPyramid, encodeWaveformPyramidFloats, waveformPyramidLevelPlan, WAVEFORM_PYRAMID_QUANT, WAVEFORM_PYRAMID_RANGE_QUANT } from '../../../../src/core/media/waveformPyramid'
import type { AudioWaveformPyramidOptions } from './types'

function pcm(values: number[]): Uint8Array {
  const bytes = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
  return bytes
}
const pyramidOptions = (overrides: Partial<AudioWaveformPyramidOptions> = {}): AudioWaveformPyramidOptions => ({
  kind: 'pyramid', channels: 2, mix: true, expectedFrames: 1000, sampleRate: 48000, startSeconds: 0, endSeconds: 1000 / 48000, nativeChannels: 2,
  baseSamplesPerBucket: 4, levelFactor: 4, topBuckets: 8, ...overrides,
})

describe('AudioWaveformAggregator', () => {
  it('aggregates arbitrarily split stereo f32 with actual linear peak/RMS and counts', () => {
    const aggregate = new AudioWaveformAggregator({ channels: 2, bucketCount: 16, expectedFrames: 32 })
    const bytes = pcm(Array.from({ length: 32 }, (_, frame) => frame % 2 ? [-1, 0.25] : [0.5, 2]).flat())
    for (let offset = 0; offset < bytes.length; offset += 7) aggregate.push(bytes.subarray(offset, offset + 7))
    const [left, right] = aggregate.finish()
    expect(left.peak).toEqual(Array(16).fill(1))
    expect(left.rms).toEqual(Array(16).fill(Math.sqrt(0.625)))
    expect(right.peak).toEqual(Array(16).fill(2))
    expect(right.rms).toEqual(Array(16).fill(Math.sqrt((4 + 0.0625) / 2)))
    expect(left.sampleCounts).toEqual(Array(16).fill(2))
    expect(left.samples).toBeUndefined()
  })
  it('keeps the signed samples of a detail range and rejects incomplete/nonfinite/oversized streams', () => {
    const aggregate = new AudioWaveformAggregator({ channels: 1, bucketCount: 2, expectedFrames: 4, keepSamples: true })
    for (const byte of pcm([-1, 0.5, 0, -0.25])) aggregate.push(Uint8Array.of(byte))
    const [mono] = aggregate.finish()
    expect(mono.peak).toEqual([1, 0.25]); expect([...mono.samples!]).toEqual([-1, 0.5, 0, -0.25])
    const bad = new AudioWaveformAggregator({ channels: 1, bucketCount: 16, expectedFrames: 16 })
    expect(() => bad.push(pcm([NaN]))).toThrow('非有限')
    expect(() => bad.push(new Uint8Array(1024 * 1024 + 1))).toThrow('上限')
    const incomplete = new AudioWaveformAggregator({ channels: 2, bucketCount: 16, expectedFrames: 16 })
    incomplete.push(Uint8Array.of(1))
    expect(() => incomplete.finish()).toThrow('不完整')
    expect(() => new AudioWaveformAggregator({ channels: 1, bucketCount: 16, expectedFrames: (1 << 22) + 1, keepSamples: true })).toThrow('规格')
  })
})

describe('AudioWaveformPyramidBuilder (multi-resolution peaks)', () => {
  it('builds every level consistently with a direct aggregation of the same samples, with a mono mix channel', () => {
    const frames = 1000
    const left = Array.from({ length: frames }, (_, frame) => Math.sin(frame / 7) * (frame < 500 ? 0.3 : 0.9))
    const right = Array.from({ length: frames }, (_, frame) => (frame % 13) / 13 - 0.5)
    const builder = new AudioWaveformPyramidBuilder(pyramidOptions())
    const bytes = pcm(left.flatMap((value, frame) => [value, right[frame]]))
    for (let offset = 0; offset < bytes.length; offset += 4093) builder.push(bytes.subarray(offset, offset + 4093))
    const { pyramid, channels } = builder.finish()
    expect(pyramid.levels.map(level => [level.samplesPerBucket, level.bucketCount])).toEqual(waveformPyramidLevelPlan(frames, 4, 4, 8).map(level => [level.samplesPerBucket, level.bucketCount]))
    expect(pyramid.channelCount).toBe(3); expect(pyramid.mixChannel).toBe(true)
    const mix = left.map((value, frame) => (value + right[frame]) / 2)
    const sources = [left, right, mix].map(values => Float32Array.from(values))
    const unit = pyramid.amplitudeScale / WAVEFORM_PYRAMID_QUANT
    const rangeUnit = pyramid.amplitudeScale / WAVEFORM_PYRAMID_RANGE_QUANT
    const low = new Float32Array(1), high = new Float32Array(1)
    const rawLow = new Float32Array(1), rawHigh = new Float32Array(1)
    for (const level of pyramid.levels) {
      for (let channel = 0; channel < 3; channel++) {
        for (let bucket = 0; bucket < level.bucketCount; bucket++) {
          const slice = sources[channel].slice(bucket * level.samplesPerBucket, (bucket + 1) * level.samplesPerBucket)
          const first = bucket * level.samplesPerBucket, end = Math.min(frames, first + level.samplesPerBucket)
          aggregateWaveformLevelRange(level, channel, pyramid.amplitudeScale, first, end, 1, low, high)
          // 原始接口包含连线右端点；这里只比较桶实际保存的首末采样，避免把下一桶首帧算进来。
          aggregateWaveformSampleRange(sources[channel], 0, first, end - 1, 1, rawLow, rawHigh)
          expect(Math.abs(low[0] - rawLow[0])).toBeLessThanOrEqual(rangeUnit / 2 + 1e-7)
          expect(Math.abs(high[0] - rawHigh[0])).toBeLessThanOrEqual(rangeUnit / 2 + 1e-7)
          expect(level.rms[channel][bucket] * unit).toBeCloseTo(Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length), 4)
        }
      }
    }
    // The observable summary is the coarsest level of the native channels and counts every frame once.
    expect(channels).toHaveLength(2)
    expect(channels[0].sampleCounts.reduce((sum, value) => sum + value, 0)).toBe(frames)
    expect(Math.max(...channels[0].peak)).toBeCloseTo(0.9, 3)
  })
  it('treats missing tail frames as silence, ignores overrun, round-trips the cache format and aggregates columns', () => {
    const builder = new AudioWaveformPyramidBuilder(pyramidOptions({ channels: 1, mix: false, nativeChannels: 1, expectedFrames: 64, endSeconds: 64 / 48000 }))
    builder.push(pcm(Array(16).fill(0.5)))
    const { pyramid } = builder.finish()
    const level = pyramid.levels[0]
    expect(pyramid.amplitudeScale).toBe(1)
    expect([...level.min[0]].slice(0, 4).every(value => value === Math.round(0.5 * WAVEFORM_PYRAMID_RANGE_QUANT))).toBe(true)
    expect([...level.max[0]]).toEqual([...level.min[0]])
    expect([...level.max[0]].slice(4).every(value => value === 0)).toBe(true)
    const decoded = decodeWaveformPyramid(encodeWaveformPyramid(pyramid))
    expect(decoded).toMatchObject({ sampleRate: 48000, frameCount: 64, channelCount: 1, nativeChannels: 1, mixChannel: false })
    expect([...decoded.levels[0].rms[0]]).toEqual([...level.rms[0]])
    const peak = new Float32Array(2); const rms = new Float32Array(2)
    aggregateWaveformLevel(decoded.levels[0], 0, decoded.amplitudeScale, 0, 32, 2, peak, rms)
    expect(peak[0]).toBeCloseTo(0.5, 4); expect(peak[1]).toBe(0)
    const overrun = new AudioWaveformPyramidBuilder(pyramidOptions({ channels: 1, mix: false, expectedFrames: 4, nativeChannels: 1 }))
    overrun.push(pcm([0.1, 0.1, 0.1, 0.1, 0.9]))
    expect(overrun.finish().pyramid.peakMax).toBeCloseTo(0.1, 6)
    expect(() => new AudioWaveformPyramidBuilder(pyramidOptions()).push(pcm([Infinity, 0]))).toThrow('非有限')
  })
  it('keeps over-full-scale float sources: the fixed-point scale follows the largest peak', () => {
    const builder = new AudioWaveformPyramidBuilder(pyramidOptions({ channels: 1, mix: false, nativeChannels: 1, expectedFrames: 8 }))
    builder.push(pcm([0, 3, 0, 1.5, 0, 0, 0, 0]))
    const { pyramid } = builder.finish()
    expect(pyramid.amplitudeScale).toBe(3); expect(pyramid.peakMax).toBe(3)
    expect(pyramid.levels[0].max[0][0] * pyramid.amplitudeScale / WAVEFORM_PYRAMID_RANGE_QUANT).toBeCloseTo(3, 6)
  })
  it('preserves single-polarity ranges and merges a short final bucket by sample energy, including missing silence', () => {
    for (const supplied of [9, 11]) {
      const builder = new AudioWaveformPyramidBuilder(pyramidOptions({ expectedFrames: 11, topBuckets: 1 }))
      const bytes = pcm(Array.from({ length: supplied }, (_, frame) => [frame < 8 ? 0.25 : 0.75, -0.5]).flat())
      for (let offset = 0; offset < bytes.length; offset += 7) builder.push(bytes.subarray(offset, offset + 7))
      const { pyramid } = builder.finish()
      const base = pyramid.levels[0], top = pyramid.levels.at(-1)!
      const unit = pyramid.amplitudeScale / WAVEFORM_PYRAMID_RANGE_QUANT
      expect(base.min[0][0] * unit).toBeCloseTo(0.25, 4)
      expect(base.max[1][0] * unit).toBeCloseTo(-0.5, 4)
      expect(base.min[0][2] * unit).toBeCloseTo(supplied === 11 ? 0.75 : 0, 4)
      expect(base.max[1][2] * unit).toBeCloseTo(supplied === 11 ? -0.5 : 0, 4)
      const expectedEnergy = (8 * 0.25 ** 2 + (supplied - 8) * 0.75 ** 2) / 11
      expect(top.rms[0][0] * pyramid.amplitudeScale / WAVEFORM_PYRAMID_QUANT).toBeCloseTo(Math.sqrt(expectedEnergy), 4)
      expect(top.rms[1][0] * pyramid.amplitudeScale / WAVEFORM_PYRAMID_QUANT).toBeCloseTo(Math.sqrt(supplied * 0.5 ** 2 / 11), 4)
    }
  })
})

describe('按块派生（编辑后声音只改了几段）', () => {
  const RATE = 48000
  function build(samples: Float32Array, options: AudioWaveformPyramidOptions, delivered = options.expectedFrames): ReturnType<AudioWaveformPyramidBuilder['finish']> {
    const builder = new AudioWaveformPyramidBuilder(options)
    const bytes = new Uint8Array(samples.buffer, 0, delivered * options.channels * 4)
    // 解码管道的分块大小不固定：结果不能随它变
    for (let offset = 0, step = 1; offset < bytes.length; step = step * 7 % 1048573 + 4) {
      const size = Math.min(step, 1024 * 1024)
      builder.push(bytes.slice(offset, offset + size)); offset += size
    }
    return builder.finish()
  }
  const signal = (frames: number): Float32Array => Float32Array.from({ length: frames * 2 }, (_, index) => Math.sin(index / 53) * 0.6 * ((index >> 14) % 5) / 5 + ((index * 7919) % 997) / 20000)
  const spansOf = (samples: Float32Array, ranges: Array<[number, number]>, frames: number, delivered = frames) => ranges.map(([start, end]) => {
    const startFrame = Math.floor(start / 1024) * 1024, endFrame = Math.min(frames, Math.ceil(end / 1024) * 1024)
    return { startFrame, endFrame, values: samples.slice(startFrame * 2, Math.min(endFrame, delivered) * 2) }
  })
  const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))

  it('只读改动所在的帧段，结果与对新声音整段生成逐字节相同，摘要也相同（可以继续往下派生）', () => {
    const frames = RATE * 30 + 777
    const options = pyramidOptions({ expectedFrames: frames, endSeconds: frames / RATE, baseSamplesPerBucket: 128, levelFactor: 8, topBuckets: 512, keepFloats: true })
    const before = signal(frames)
    const after = before.slice()
    const changes: Array<[number, number]> = [[0, 500], [100_000, 101_000], [900_000, 905_500], [frames - 300, frames]]
    for (const [start, end] of changes) for (let index = start * 2; index < end * 2; index++) after[index] = after[index] * 0.5 + 0.01
    const parent = build(before, options), full = build(after, options)
    const spans = spansOf(after, changes, frames)
    expect(spans.reduce((sum, part) => sum + part.endFrame - part.startFrame, 0)).toBeLessThan(frames / 100)
    const derived = deriveWaveformPyramid(parent.pyramid, parent.floats!, options, spans, frames)
    if ('reason' in derived) throw new Error(derived.reason)
    expect(same(encodeWaveformPyramid(derived.pyramid), encodeWaveformPyramid(full.pyramid))).toBe(true)
    expect(same(encodeWaveformPyramidFloats(derived.floats), encodeWaveformPyramidFloats(full.floats!))).toBe(true)
  })
  it('尾部缺帧按静音处理，与整段生成一致；全段峰值超过满幅且变了时交回整段生成', () => {
    const frames = RATE * 4
    const options = pyramidOptions({ expectedFrames: frames, endSeconds: frames / RATE, baseSamplesPerBucket: 128, levelFactor: 8, topBuckets: 64, keepFloats: true })
    const before = signal(frames), after = before.slice()
    after.fill(0.2, (frames - 5000) * 2, (frames - 4000) * 2)
    const delivered = frames - 1500
    const parent = build(before, options, delivered), full = build(after, options, delivered)
    const derived = deriveWaveformPyramid(parent.pyramid, parent.floats!, options, spansOf(after, [[frames - 5000, frames - 4000]], frames, delivered), delivered)
    if ('reason' in derived) throw new Error(derived.reason)
    expect(same(encodeWaveformPyramid(derived.pyramid), encodeWaveformPyramid(full.pyramid))).toBe(true)
    const loud = before.slice(); loud[2000 * 2] = 1.5
    expect(deriveWaveformPyramid(parent.pyramid, parent.floats!, options, spansOf(loud, [[2000, 2001]], frames, delivered), delivered)).toMatchObject({ reason: expect.stringContaining('定点比例') })
  })
  it('补录拼接后长度变了：拼接点之前的桶原样沿用，之后重算，与对新声音整段生成逐字节相同；末尾追加只重算录音段', () => {
    const frames = RATE * 30 + 777
    const before = signal(frames)
    const take = Float32Array.from({ length: 12_345 * 2 }, (_, index) => Math.cos(index / 17) * 0.4)
    for (const [start, end] of [[frames, frames], [400_000, 400_000], [700_000, 760_000]] as const) {
      const length = frames - (end - start) + take.length / 2
      const after = new Float32Array(length * 2)
      after.set(before.subarray(0, start * 2)); after.set(take, start * 2); after.set(before.subarray(end * 2), (start + take.length / 2) * 2)
      const options = (expectedFrames: number) => pyramidOptions({ expectedFrames, endSeconds: expectedFrames / RATE, baseSamplesPerBucket: 128, levelFactor: 8, topBuckets: 512, keepFloats: true })
      const parent = build(before, options(frames)), full = build(after, options(length))
      // 来历给出的不同帧是 [拼接点, 新结尾)，按块分批交进去
      const from = Math.floor(start / 1024) * 1024
      const spans = Array.from({ length: Math.ceil((length - from) / 65536) }, (_, index) => [from + index * 65536, Math.min(length, from + (index + 1) * 65536)] as [number, number])
      const derived = deriveWaveformPyramid(parent.pyramid, parent.floats!, options(length), spansOf(after, spans, length), length)
      if ('reason' in derived) throw new Error(derived.reason)
      expect(same(encodeWaveformPyramid(derived.pyramid), encodeWaveformPyramid(full.pyramid))).toBe(true)
      expect(same(encodeWaveformPyramidFloats(derived.floats), encodeWaveformPyramidFloats(full.floats!))).toBe(true)
      if (start === frames) expect(length - from).toBeLessThan(take.length / 2 + 1024)
    }
    // 长度变了而交进来的段没盖住尾部：不能把对不上位置的旧桶当成没变
    const parent = build(before, pyramidOptions({ expectedFrames: frames, endSeconds: frames / RATE, baseSamplesPerBucket: 128, levelFactor: 8, topBuckets: 512, keepFloats: true }))
    const longer = pyramidOptions({ expectedFrames: frames + 5000, endSeconds: (frames + 5000) / RATE, baseSamplesPerBucket: 128, levelFactor: 8, topBuckets: 512, keepFloats: true })
    expect(deriveWaveformPyramid(parent.pyramid, parent.floats!, longer, [], frames + 5000)).toMatchObject({ reason: expect.stringContaining('尾部') })
  })
})

describe('real source Node Worker', () => {
  it('uses the same aggregation source, a single in-flight block, and closes idempotently', async () => {
    const worker = new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts'))
    try {
      await worker.start({ channels: 1, bucketCount: 16, expectedFrames: 32 })
      const first = worker.push(pcm(Array(32).fill(0.5)))
      await expect(worker.push(pcm([1]))).rejects.toThrow('一个在途')
      await first
      expect((await worker.finish())[0].rms).toEqual(Array(16).fill(0.5))
    } finally { await worker.dispose() }
    expect(worker.dispose()).toBe(worker.dispose())
    await expect(worker.push(pcm([1]))).rejects.toThrow('已关闭')
  })
  it('builds a pyramid in the Worker and transfers its typed arrays', async () => {
    const worker = new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts'))
    try {
      await worker.start(pyramidOptions({ channels: 1, mix: false, nativeChannels: 1, expectedFrames: 64 }))
      await worker.push(pcm(Array(64).fill(0.25)))
      const { pyramid, channels } = await worker.finishPyramid()
      expect(pyramid.levels[0].min[0]).toBeInstanceOf(Int16Array)
      expect(pyramid.levels[0].max[0][0]).toBe(Math.round(0.25 * WAVEFORM_PYRAMID_RANGE_QUANT))
      expect(pyramid.peakMax).toBe(0.25)
      expect(channels[0].sampleCounts.reduce((sum, value) => sum + value, 0)).toBe(64)
    } finally { await worker.dispose() }
  })
  it('rejects a pending maximum-size chunk and waits for Worker termination during cancellation', async () => {
    const worker = new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts'))
    await worker.start({ channels: 2, bucketCount: 4096, expectedFrames: 48000 * 1800 })
    const pending = worker.push(new Uint8Array(1024 * 1024))
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await worker.dispose(); await rejection
    await expect(worker.finish()).rejects.toThrow('已关闭')
  })
})
