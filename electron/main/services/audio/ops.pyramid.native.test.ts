import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAudioWaveformService } from './ops'
import { AudioWaveformWorker } from './worker-client'
import { createWaveformDiskCache } from './waveform-cache'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { aggregateWaveformLevel, selectWaveformLevel, WAVEFORM_PYRAMID_QUANT } from '../../../../src/core/media/waveformPyramid'
import type { AudioWaveformPyramid, AudioWaveformPyramidResult } from '../../../../src/platform/contracts/audioWaveform'

vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), error: vi.fn() }) }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (source: string) => source }))
vi.mock('../image/source', () => ({ normalizeLocalSource: (source: string) => source }))
const run = promisify(execFile)

function wav(samples: number[][], rate: number): Buffer {
  const channelCount = samples.length
  const dataSize = samples[0].length * channelCount * 4
  const output = Buffer.alloc(44 + dataSize)
  output.write('RIFF', 0); output.writeUInt32LE(36 + dataSize, 4); output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16); output.writeUInt16LE(3, 20); output.writeUInt16LE(channelCount, 22)
  output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate * channelCount * 4, 28)
  output.writeUInt16LE(channelCount * 4, 32); output.writeUInt16LE(32, 34)
  output.write('data', 36); output.writeUInt32LE(dataSize, 40)
  for (let frame = 0; frame < samples[0].length; frame++) for (let channel = 0; channel < channelCount; channel++) output.writeFloatLE(samples[channel][frame], 44 + (frame * channelCount + channel) * 4)
  return output
}
function pyramid(result: AudioWaveformPyramidResult): AudioWaveformPyramid {
  if ('notModified' in result) throw new Error('expected a pyramid')
  return result
}

describe.skipIf(process.env.HENJI_AUDIO_WAVEFORM_NATIVE !== '1')('real ffmpeg whole-source pyramid', () => {
  let directory: string
  let binary: string
  let probe: string
  beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-waveform-pyramid-')); binary = await loadFfmpegPath(); probe = await loadFfprobePath() })
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }) })
  function service(cache: string, workers: { count: number }): ReturnType<typeof createAudioWaveformService> {
    return createAudioWaveformService({
      ffmpegPath: async () => binary, ffprobePath: async () => probe, diskCache: createWaveformDiskCache({ directory: () => cache }),
      createWorker: () => { workers.count++; return new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts')) },
    })
  }

  it('matches the real samples at level 0 on the absolute clock and reopens from disk without decoding', async () => {
    const rate = 44100
    const left = Array.from({ length: rate }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * 440 * frame / rate))
    const right = Array(rate).fill(-0.25) as number[]
    left[1000] = 0.9
    const source = path.join(directory, 'tone.wav')
    await fs.writeFile(source, wav([left, right], rate))
    const cache = path.join(directory, 'cache-a')
    const workers = { count: 0 }
    const first = service(cache, workers)
    const stereo = pyramid(await first.extractPyramid({ source, channels: 2 }))
    expect(stereo).toMatchObject({ sampleRate: rate, frameCount: rate, channelCount: 2 })
    const unit = stereo.amplitudeScale / WAVEFORM_PYRAMID_QUANT
    const level = stereo.levels[0]
    for (const bucket of [0, 7, 100, level.bucketCount - 1]) {
      const slice = left.slice(bucket * 128, (bucket + 1) * 128)
      expect(level.peak[0][bucket] * unit).toBeCloseTo(Math.max(...slice.map(Math.abs)), 4)
    }
    expect(level.peak[0][Math.floor(1000 / 128)] * unit).toBeCloseTo(0.9, 4)
    expect(level.rms[1][3] * unit).toBeCloseTo(0.25, 4)
    await first.dispose()
    expect(workers.count).toBe(1)
    const second = service(cache, workers)
    const reopened = pyramid(await second.extractPyramid({ source, channels: 1, audioChannel: 1 }))
    expect(reopened.peakMax).toBeCloseTo(0.25, 4)
    expect(workers.count).toBe(1)
    await second.dispose()
  }, 30_000)

  it.skipIf(process.env.HENJI_AUDIO_WAVEFORM_BENCH !== '1')('measures a 60-minute source: first build, disk reopen and per-frame slicing cost', async () => {
    const source = path.join(directory, 'hour.m4a')
    const encodeStarted = performance.now()
    await run(binary, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=3600:c=pink:r=48000:a=0.3,apulsator=hz=0.7', '-ac', '2', '-c:a', 'aac', '-b:a', '96k', '-y', source], { windowsHide: true, maxBuffer: 1 << 20 })
    const encodeMs = performance.now() - encodeStarted
    const cache = path.join(directory, 'cache-hour')
    const workers = { count: 0 }
    const first = service(cache, workers)
    let started = performance.now()
    const built = pyramid(await first.extractPyramid({ source, channels: 2 }))
    const firstMs = performance.now() - started
    started = performance.now()
    pyramid(await first.extractPyramid({ source, channels: 1 }))
    const memoryMs = performance.now() - started
    await first.dispose()
    const second = service(cache, workers)
    started = performance.now()
    const reopened = pyramid(await second.extractPyramid({ source, channels: 2 }))
    const diskMs = performance.now() - started
    await second.dispose()
    const files = await fs.readdir(cache)
    const bytes = (await Promise.all(files.map(name => fs.stat(path.join(cache, name))))).reduce((sum, stat) => sum + stat.size, 0)
    // Slicing cost per redraw: 1600 device columns, from the whole hour down to 3 s (level 0).
    const columns = 1600
    const peak = new Float32Array(columns); const rms = new Float32Array(columns)
    const zooms = [3600, 600, 60, 10, 3].map(seconds => {
      const frames = seconds * built.sampleRate
      const level = selectWaveformLevel(built.levels, frames / columns)
      const rounds = 200
      const t0 = performance.now()
      for (let round = 0; round < rounds; round++) for (let channel = 0; channel < 2; channel++) aggregateWaveformLevel(level, channel, built.amplitudeScale, round * 997, round * 997 + frames, columns, peak, rms)
      return { seconds, samplesPerBucket: level.samplesPerBucket, msPerFrame: (performance.now() - t0) / rounds }
    })
    // Timeline with 60 audio clips of 20 s each, 200 px wide.
    const t0 = performance.now()
    for (let clip = 0; clip < 60; clip++) {
      const frames = 20 * built.sampleRate
      const level = selectWaveformLevel(built.levels, frames / 200)
      for (let channel = 0; channel < 2; channel++) aggregateWaveformLevel(level, channel, built.amplitudeScale, clip * frames, (clip + 1) * frames, 200, peak, rms)
    }
    const timelineMs = performance.now() - t0
    process.stdout.write(`[waveform-bench] ${JSON.stringify({ encodeMs: Math.round(encodeMs), firstMs: Math.round(firstMs), memoryMs: Math.round(memoryMs), diskMs: Math.round(diskMs), cacheBytes: bytes, levels: built.levels.map(level => [level.samplesPerBucket, level.bucketCount]), zooms, timelineMs: Number(timelineMs.toFixed(3)) })}\n`)
    expect(workers.count).toBe(1)
    expect(reopened.version).toBe(built.version)
  }, 600_000)
})
