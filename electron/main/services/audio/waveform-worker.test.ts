import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { AudioWaveformAggregator, AudioWaveformPyramidBuilder } from './waveform-worker'
import { AudioWaveformWorker } from './worker-client'
import { aggregateWaveformLevel, decodeWaveformPyramid, encodeWaveformPyramid, waveformPyramidLevelPlan, WAVEFORM_PYRAMID_QUANT } from '../../../../src/core/media/waveformPyramid'
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
    const sources = [left, right, mix]
    const unit = pyramid.amplitudeScale / WAVEFORM_PYRAMID_QUANT
    for (const level of pyramid.levels) {
      for (let channel = 0; channel < 3; channel++) {
        for (let bucket = 0; bucket < level.bucketCount; bucket++) {
          const slice = sources[channel].slice(bucket * level.samplesPerBucket, (bucket + 1) * level.samplesPerBucket)
          expect(level.peak[channel][bucket] * unit).toBeCloseTo(Math.max(...slice.map(Math.abs)), 4)
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
    expect([...level.peak[0]].slice(0, 4).every(value => value === Math.round(0.5 * WAVEFORM_PYRAMID_QUANT))).toBe(true)
    expect([...level.peak[0]].slice(4).every(value => value === 0)).toBe(true)
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
    expect(pyramid.levels[0].peak[0][0] * pyramid.amplitudeScale / WAVEFORM_PYRAMID_QUANT).toBeCloseTo(3, 6)
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
      expect(pyramid.levels[0].peak[0]).toBeInstanceOf(Uint16Array)
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
