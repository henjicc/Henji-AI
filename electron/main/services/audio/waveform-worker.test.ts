import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { AudioWaveformAggregator } from './waveform-worker'
import { AudioWaveformWorker } from './worker-client'

function pcm(values: number[], format: 's16le' | 'f32le' = 'f32le'): Uint8Array {
  const bytes = Buffer.alloc(values.length * (format === 'f32le' ? 4 : 2))
  values.forEach((value, index) => format === 'f32le' ? bytes.writeFloatLE(value, index * 4) : bytes.writeInt16LE(value, index * 2))
  return bytes
}

describe('AudioWaveformAggregator', () => {
  it('aggregates arbitrarily split stereo f32 with actual linear peak/RMS and counts', () => {
    const aggregate = new AudioWaveformAggregator({ format: 'f32le', channels: 2, bucketCount: 16, expectedFrames: 32 })
    const bytes = pcm(Array.from({ length: 32 }, (_, frame) => frame % 2 ? [-1, 0.25] : [0.5, 2]).flat())
    for (let offset = 0; offset < bytes.length; offset += 7) aggregate.push(bytes.subarray(offset, offset + 7))
    const [left, right] = aggregate.finish()
    expect(left.peak).toEqual(Array(16).fill(1))
    expect(left.rms).toEqual(Array(16).fill(Math.sqrt(0.625)))
    expect(right.peak).toEqual(Array(16).fill(2))
    expect(right.rms).toEqual(Array(16).fill(Math.sqrt((4 + 0.0625) / 2)))
    expect(left.sampleCounts).toEqual(Array(16).fill(2))
  })
  it('preserves legacy mono s16 and rejects incomplete/nonfinite/oversized streams', () => {
    const aggregate = new AudioWaveformAggregator({ format: 's16le', channels: 1, bucketCount: 2, expectedFrames: 4 })
    const bytes = pcm([-32768, 16384, 0, -8192], 's16le')
    for (const byte of bytes) aggregate.push(Uint8Array.of(byte))
    expect(aggregate.finish()[0]).toEqual({ peak: [1, 0.25], rms: [Math.sqrt(0.625), Math.sqrt(0.03125)], sampleCounts: [2, 2] })
    const bad = new AudioWaveformAggregator({ format: 'f32le', channels: 1, bucketCount: 16, expectedFrames: 16 })
    expect(() => bad.push(pcm([NaN]))).toThrow('非有限')
    expect(() => bad.push(new Uint8Array(1024 * 1024 + 1))).toThrow('上限')
    const incomplete = new AudioWaveformAggregator({ format: 'f32le', channels: 2, bucketCount: 16, expectedFrames: 16 })
    incomplete.push(Uint8Array.of(1))
    expect(() => incomplete.finish()).toThrow('不完整')
  })
})

describe('real source Node Worker', () => {
  it('uses the same aggregation source, a single in-flight block, and closes idempotently', async () => {
    const worker = new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts'))
    try {
      await worker.start({ format: 'f32le', channels: 1, bucketCount: 16, expectedFrames: 32 })
      const first = worker.push(pcm(Array(32).fill(0.5)))
      await expect(worker.push(pcm([1]))).rejects.toThrow('一个在途')
      await first
      expect((await worker.finish())[0].rms).toEqual(Array(16).fill(0.5))
    } finally { await worker.dispose() }
    expect(worker.dispose()).toBe(worker.dispose())
    await expect(worker.push(pcm([1]))).rejects.toThrow('已关闭')
  })
  it('rejects a pending maximum-size chunk and waits for Worker termination during cancellation', async () => {
    const worker = new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts'))
    await worker.start({ format: 'f32le', channels: 2, bucketCount: 4096, expectedFrames: 48000 * 1800 })
    const pending = worker.push(new Uint8Array(1024 * 1024))
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await worker.dispose(); await rejection
    await expect(worker.finish()).rejects.toThrow('已关闭')
  })
})
