import { describe, expect, it } from 'vitest'
import {
  aggregateWaveformLevel, aggregateWaveformLevelRange, aggregateWaveformSampleRange, aggregateWaveformSamples, audioWaveformSampleIndex, decodeWaveformPyramid, encodeWaveformPyramid, selectWaveformLevel, waveformPyramidLevelPlan, waveformPyramidPeakMax,
  WAVEFORM_PYRAMID_QUANT, WAVEFORM_PYRAMID_RANGE_QUANT, waveformPyramidByteSize, type WaveformPyramidData,
} from './waveformPyramid'

function sample(): WaveformPyramidData {
  const plan = waveformPyramidLevelPlan(4096, 16, 4, 8)
  return {
    sampleRate: 48000, frameCount: 4096, startSeconds: 0.25, endSeconds: 4096 / 48000, amplitudeScale: 2, peakMax: 1.5, channelCount: 2, nativeChannels: 2, mixChannel: false,
    levels: plan.map((level, index) => ({ ...level,
      min: [0, 1].map(channel => Int16Array.from({ length: level.bucketCount }, (_, bucket) => -(bucket * 7 + channel * 3 + index))),
      max: [0, 1].map(channel => Int16Array.from({ length: level.bucketCount }, (_, bucket) => bucket * 5 + channel * 2 + index)),
      rms: [0, 1].map(() => new Uint16Array(level.bucketCount).fill(100)),
    })),
  }
}

describe('waveform pyramid format and slicing', () => {
  it('plans levels by an integer factor until the top level is small', () => {
    expect(waveformPyramidLevelPlan(48000 * 3600)).toEqual([
      { samplesPerBucket: 128, bucketCount: 1_350_000 }, { samplesPerBucket: 1024, bucketCount: 168_750 },
      { samplesPerBucket: 8192, bucketCount: 21_094 }, { samplesPerBucket: 65536, bucketCount: 2637 }, { samplesPerBucket: 524288, bucketCount: 330 },
    ])
    expect(waveformPyramidLevelPlan(100)).toEqual([{ samplesPerBucket: 128, bucketCount: 1 }])
    expect(audioWaveformSampleIndex(123457, 44100)).toBe(5445)
  })
  it('round-trips the binary file, including an unaligned input, and rejects truncation, wrong version and inconsistent tables', () => {
    const data = sample()
    const bytes = encodeWaveformPyramid(data)
    const decoded = decodeWaveformPyramid(bytes)
    expect(decoded).toMatchObject({ sampleRate: 48000, frameCount: 4096, startSeconds: 0.25, amplitudeScale: 2, peakMax: 1.5, channelCount: 2 })
    expect(decoded).toEqual(data)
    expect(waveformPyramidByteSize(data)).toBe(bytes.byteLength)
    const shifted = new Uint8Array(bytes.length + 1); shifted.set(bytes, 1)
    expect(decodeWaveformPyramid(shifted.subarray(1))).toEqual(data)
    expect(() => decodeWaveformPyramid(bytes.subarray(0, bytes.length - 2))).toThrow('长度')
    const version = bytes.slice(); version[4] = 1
    expect(() => decodeWaveformPyramid(version)).toThrow('版本')
    const table = bytes.slice(); new DataView(table.buffer).setUint32(64 + 4, 3, true)
    expect(() => decodeWaveformPyramid(table)).toThrow('级表')
    expect(() => decodeWaveformPyramid(new Uint8Array(80))).toThrow('不是波形缓存')
  })
  it('picks the coarsest level that still has a bucket per column and aggregates peak = max, RMS = quadratic mean', () => {
    const levels = sample().levels
    expect(selectWaveformLevel(levels, 10).samplesPerBucket).toBe(16)
    expect(selectWaveformLevel(levels, 70).samplesPerBucket).toBe(64)
    expect(selectWaveformLevel(levels, 1e9).samplesPerBucket).toBe(levels.at(-1)!.samplesPerBucket)
    const level = { samplesPerBucket: 4, bucketCount: 4, min: [Int16Array.of(-100, 100, -200, -300)], max: [Int16Array.of(-50, 400, 100, -50)], rms: [Uint16Array.of(30, 40, 0, 0)] }
    const peak = new Float32Array(2); const rms = new Float32Array(2)
    aggregateWaveformLevel(level, 0, WAVEFORM_PYRAMID_RANGE_QUANT, 0, 16, 2, peak, rms)
    expect([...peak]).toEqual([400, 300]); expect(rms[0]).toBeCloseTo(Math.sqrt((900 + 1600) / 2) * WAVEFORM_PYRAMID_RANGE_QUANT / WAVEFORM_PYRAMID_QUANT, 4); expect(rms[1]).toBe(0)
    // 兼容峰值接口在范围外输出静音。
    const fine = new Float32Array(4)
    aggregateWaveformLevel(level, 0, WAVEFORM_PYRAMID_RANGE_QUANT, 0, 2, 4, fine, new Float32Array(4))
    expect([...fine]).toEqual([100, 100, 100, 100])
    aggregateWaveformLevel(level, 0, WAVEFORM_PYRAMID_QUANT, 100, 200, 2, peak, rms)
    expect([...peak]).toEqual([0, 0])
    expect(waveformPyramidPeakMax({ ...sample(), levels: [level] }, [0])).toBeCloseTo(400 * 2 / WAVEFORM_PYRAMID_RANGE_QUANT, 9)
  })
  it('aggregates signed raw samples for the detail tier with the same rule', () => {
    const samples = Float32Array.of(0.5, -1, 0.25, 0, -0.5, 0.5)
    const peak = new Float32Array(3); const rms = new Float32Array(3)
    aggregateWaveformSamples(samples, 100, 100, 106, 3, peak, rms)
    expect([...peak]).toEqual([1, 0.25, 0.5])
    expect(rms[0]).toBeCloseTo(Math.sqrt((0.25 + 1) / 2), 6)
  })
  it('aggregates signed ranges across columns, retains DC offsets and extends the edge buckets', () => {
    const samples = Float32Array.of(0, -1, 0.4, 0, 0.1, 0.8, 0.2, 0, 0, -0.6, 0.3, 0)
    const level = { samplesPerBucket: 4, bucketCount: 3,
      min: [Int16Array.from([-1, 0, -0.6], value => Math.round(value * WAVEFORM_PYRAMID_RANGE_QUANT))],
      max: [Int16Array.from([0.4, 0.8, 0.3], value => Math.round(value * WAVEFORM_PYRAMID_RANGE_QUANT))], rms: [new Uint16Array(3)],
    }
    for (const count of [1, 3]) {
      const low = new Float32Array(count), high = new Float32Array(count)
      const rawLow = new Float32Array(count), rawHigh = new Float32Array(count)
      aggregateWaveformLevelRange(level, 0, 1, 0, 12, count, low, high)
      aggregateWaveformSampleRange(samples, 0, 0, 12, count, rawLow, rawHigh)
      for (let column = 0; column < count; column++) {
        expect(Math.abs(low[column] - rawLow[column])).toBeLessThanOrEqual(0.5 / WAVEFORM_PYRAMID_RANGE_QUANT + 1e-7)
        expect(Math.abs(high[column] - rawHigh[column])).toBeLessThanOrEqual(0.5 / WAVEFORM_PYRAMID_RANGE_QUANT + 1e-7)
      }
    }
    const dc = { samplesPerBucket: 4, bucketCount: 2, min: [Int16Array.of(100, -400)], max: [Int16Array.of(200, -300)], rms: [new Uint16Array(2)] }
    const low = new Float32Array(2), high = new Float32Array(2)
    aggregateWaveformLevelRange(dc, 0, WAVEFORM_PYRAMID_RANGE_QUANT, 0, 8, 2, low, high)
    expect([...low]).toEqual([100, -400]); expect([...high]).toEqual([200, -300])
    aggregateWaveformLevelRange(dc, 0, WAVEFORM_PYRAMID_RANGE_QUANT, -8, 16, 2, low, high)
    expect([...low]).toEqual([100, -400]); expect([...high]).toEqual([200, -300])
    aggregateWaveformLevelRange(dc, 0, WAVEFORM_PYRAMID_RANGE_QUANT, 3.5, 4.5, 1, low, high)
    expect(low[0]).toBe(-400); expect(high[0]).toBe(200)
    aggregateWaveformLevelRange({ ...dc, bucketCount: 0, min: [new Int16Array()], max: [new Int16Array()], rms: [new Uint16Array()] }, 0, 1, 0, 8, 2, low, high)
    expect([...low]).toEqual([0, 0]); expect([...high]).toEqual([0, 0])
  })
})
