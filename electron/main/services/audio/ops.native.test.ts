import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAudioWaveformService, audioWaveformSampleIndex } from './ops'
import { AudioWaveformWorker } from './worker-client'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'

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

describe.skipIf(process.env.HENJI_AUDIO_WAVEFORM_NATIVE !== '1')('real ffmpeg source-range waveform', () => {
  let directory: string
  let binary: string
  let probe: string
  const services: ReturnType<typeof createAudioWaveformService>[] = []
  beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-waveform-range-')); binary = await loadFfmpegPath(); probe = await loadFfprobePath() })
  afterAll(async () => { await Promise.all(services.map(service => service.dispose())); await fs.rm(directory, { recursive: true, force: true }) })
  function service(): ReturnType<typeof createAudioWaveformService> {
    const item = createAudioWaveformService({ ffmpegPath: async () => binary, ffprobePath: async () => probe, createWorker: () => new AudioWaveformWorker(path.resolve('electron/main/services/audio/waveform-worker.ts')) })
    services.push(item); return item
  }
  it.each([44100, 48000])('retains %iHz stereo spikes at integer-us half-open boundaries without normalization', async rate => {
    const source = path.join(directory, `stereo-${rate}.wav`)
    const startUs = 123457; const endUs = 223457
    const first = audioWaveformSampleIndex(startUs, rate); const end = audioWaveformSampleIndex(endUs, rate)
    const left = Array(rate).fill(0.25) as number[]; const right = Array(rate).fill(-0.5) as number[]
    left[first - 1] = 3; left[first] = 2; left[end - 1] = 1; left[end] = 4
    await fs.writeFile(source, wav([left, right], rate))
    const result = await service().extractRange({ source, startUs, endUs, channels: 2, bucketCount: 16, sourceRevision: 'r1' })
    expect(result.sampleRate).toBe(rate); expect(result.channelCount).toBe(2)
    expect(result.sourceRevision).toBe('r1')
    expect(result.channels[0].peak[0]).toBe(2); expect(result.channels[0].peak.at(-1)).toBe(1)
    expect(result.channels[0].peak.every(value => value <= 2)).toBe(true)
    expect(result.channels[1].peak).toEqual(Array(16).fill(0.5))
    expect(result.channels[1].rms).toEqual(Array(16).fill(0.5))
    expect(result.channels[0].sampleCounts.reduce((a, b) => a + b, 0)).toBe(end - first)
    const firstCount = result.channels[0].sampleCounts[0]
    expect(result.channels[0].rms[0]).toBeCloseTo(Math.sqrt((4 + (firstCount - 1) * 0.0625) / firstCount), 10)
  }, 20_000)
  it('retains source-clock silence for a delayed real PCM audio stream and seeks into that stream', async () => {
    const original = path.join(directory, 'constant.wav')
    const delayed = path.join(directory, 'delayed.mkv')
    await fs.writeFile(original, wav([Array(48000).fill(0.5)], 48000))
    await run(binary, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=10:d=1.5', '-itsoffset', '0.25', '-i', original, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'ffv1', '-c:a', 'pcm_f32le', '-y', delayed], { windowsHide: true })
    const analyzer = service()
    const result = await analyzer.extractRange({ source: delayed, startUs: 0, endUs: 500000, bucketCount: 16, channels: 2 })
    expect(result.channelCount).toBe(1)
    expect(result.channels[0].peak.slice(0, 8)).toEqual(Array(8).fill(0))
    expect(result.channels[0].peak.slice(8)).toEqual(Array(8).fill(0.5))
    const sought = await analyzer.extractRange({ source: delayed, startUs: 600000, endUs: 800000, bucketCount: 16, channels: 1 })
    expect(sought.channels[0].peak).toEqual(Array(16).fill(0.5))
    expect(sought.channels[0].rms).toEqual(Array(16).fill(0.5))
    expect(sought.channels[0].sampleCounts.reduce((a, b) => a + b, 0)).toBe(9600)
  }, 20_000)
  it('reads a container starting after zero on the absolute clock: silence before the start, the absolute end is in range', async () => {
    const original = path.join(directory, 'offset-source.wav')
    const shifted = path.join(directory, 'offset.mov')
    await fs.writeFile(original, wav([Array(48000).fill(0.5)], 48000))
    await run(binary, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=10:d=1', '-i', original, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'mjpeg', '-c:a', 'pcm_f32le', '-output_ts_offset', '1', '-y', shifted], { windowsHide: true })
    const analyzer = service()
    const whole = await analyzer.extractRange({ source: shifted, startUs: 0, endUs: 2_000_000, bucketCount: 16, channels: 1 })
    expect(whole.durationSeconds).toBeCloseTo(2, 3)
    expect(whole.channels[0].peak.slice(0, 8)).toEqual(Array(8).fill(0))
    expect(whole.channels[0].peak.slice(8)).toEqual(Array(8).fill(0.5))
    const sought = await analyzer.extractRange({ source: shifted, startUs: 1_200_000, endUs: 1_400_000, bucketCount: 16, channels: 1 })
    expect(sought.channels[0].peak).toEqual(Array(16).fill(0.5))
    expect(sought.channels[0].sampleCounts.reduce((a, b) => a + b, 0)).toBe(9600)
    const straddle = await analyzer.extractRange({ source: shifted, startUs: 900_000, endUs: 1_100_000, bucketCount: 16, channels: 1 })
    expect(straddle.channels[0].peak.slice(0, 8)).toEqual(Array(8).fill(0))
    expect(straddle.channels[0].peak.slice(8)).toEqual(Array(8).fill(0.5))
  }, 20_000)
  const mpegPs = path.resolve('node_modules/.cache/native-decode/mpeg2.mpg')
  it.skipIf(!existsSync(mpegPs))('generates the whole-length waveform of the MPEG-PS sample that starts at 0.523s', async () => {
    const analyzer = service()
    // Imported duration: picture 0.533367 + 3.069733; sound spans 0.523344..3.523344.
    const result = await analyzer.extractRange({ source: mpegPs, startUs: 0, endUs: 3_603_100, bucketCount: 64, channels: 2 })
    expect(result.durationSeconds).toBeCloseTo(3.6031, 6)
    const bucketUs = 3_603_100 / 64
    const counts = result.channels[0].sampleCounts
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(48000 * 2.99)
    expect(result.channels[0].peak.slice(0, Math.floor(523_344 / bucketUs))).toEqual(Array(Math.floor(523_344 / bucketUs)).fill(0))
    expect(Math.max(...result.channels[0].peak)).toBeGreaterThan(0)
  }, 20_000)
  it('rechecks file identity on legacy and range cache hits and never shares mutable arrays', async () => {
    const source = path.join(directory, 'refresh.wav')
    await fs.writeFile(source, wav([Array(4800).fill(0.25)], 48000))
    const analyzer = service()
    const request = { source, startUs: 0, endUs: 100000, bucketCount: 16, channels: 1 as const }
    const first = await analyzer.extractRange(request)
    first.channels[0].peak[0] = 99
    expect((await analyzer.extractRange(request)).channels[0].peak[0]).toBe(0.25)
    const legacy = await analyzer.extractSamples(source, 16)
    const prior = await fs.stat(source)
    await fs.writeFile(source, wav([Array(4800).fill(0.5)], 48000))
    await fs.utimes(source, prior.atime, prior.mtime)
    const refreshed = await analyzer.extractRange(request)
    expect(refreshed.fileIdentity).not.toBe(first.fileIdentity)
    expect(refreshed.channels[0].peak[0]).toBe(0.5)
    expect((await analyzer.extractSamples(source, 16)).peak[0]).toBeGreaterThan(legacy.peak[0])
  }, 20_000)
  it('seeks into delayed AAC using original 48kHz samples and preserves the silent lead-in', async () => {
    const original = path.join(directory, 'aac-source.wav'); const delayed = path.join(directory, 'delayed-aac.mkv')
    await fs.writeFile(original, wav([Array.from({ length: 48000 }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * frame * 1000 / 48000))], 48000))
    await run(binary, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=10:d=1.5', '-itsoffset', '0.25', '-i', original, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'ffv1', '-c:a', 'aac', '-y', delayed], { windowsHide: true })
    const analyzer = service()
    const lead = await analyzer.extractRange({ source: delayed, startUs: 0, endUs: 200000, bucketCount: 16, channels: 1 })
    expect(lead.channels[0].peak).toEqual(Array(16).fill(0))
    const sought = await analyzer.extractRange({ source: delayed, startUs: 600000, endUs: 800000, bucketCount: 16, channels: 1 })
    expect(sought.sampleRate).toBe(48000)
    expect(sought.channels[0].sampleCounts.reduce((a, b) => a + b, 0)).toBe(9600)
    for (const value of sought.channels[0].rms) expect(value).toBeGreaterThan(0.34)
    for (const value of sought.channels[0].rms) expect(value).toBeLessThan(0.37)
  }, 20_000)
})
