import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioWaveformAggregator, AudioWaveformPyramidBuilder } from './waveform-worker'
import { createContentDiskCache } from '../media/content-disk-cache'
import type { AudioWaveformChannel, AudioWaveformPyramidOutput, AudioWaveformPyramidResult, AudioWaveformWorkerOptions } from './types'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), error: vi.fn() }) }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (source: string) => source }))
vi.mock('../image/source', () => ({ normalizeLocalSource: (source: string) => source }))
import { createAudioWaveformService } from './ops'

class Process extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
}
function worker(): { start: (options: AudioWaveformWorkerOptions) => Promise<void>; push: (chunk: Uint8Array) => Promise<void>; finish: () => Promise<AudioWaveformChannel[]>; finishPyramid: () => Promise<AudioWaveformPyramidOutput>; dispose: () => Promise<void> } {
  let aggregate: AudioWaveformAggregator | AudioWaveformPyramidBuilder
  return {
    start: async options => { aggregate = options.kind === 'pyramid' ? new AudioWaveformPyramidBuilder(options) : new AudioWaveformAggregator(options) },
    push: async chunk => { aggregate.push(chunk) },
    finish: async () => (aggregate as AudioWaveformAggregator).finish(),
    finishPyramid: async () => (aggregate as AudioWaveformPyramidBuilder).finish(),
    dispose: vi.fn(async () => undefined),
  }
}
const localMedia = (name: string): string => path.resolve(path.sep, 'media', name)
function samples(values: number[]): Buffer { const bytes = Buffer.alloc(values.length * 4); values.forEach((value, index) => bytes.writeFloatLE(value, index * 4)); return bytes }
function pyramid(result: AudioWaveformPyramidResult): Exclude<AudioWaveformPyramidResult, { notModified: true }> {
  if ('notModified' in result) throw new Error('expected a pyramid')
  return result
}
let children: Array<{ process: Process; args: string[] }>
function probeWith(streams: Array<Record<string, unknown>>, duration = '0.01'): void {
  mocks.spawn.mockImplementation((binary: string, args: string[]) => {
    const child = new Process()
    if (binary === 'probe') queueMicrotask(() => { child.stdout.end(JSON.stringify({ format: { duration }, streams })); child.emit('close', 0) })
    else children.push({ process: child, args })
    return child
  })
}
function finish(index: number, values: number[]): void { children[index].process.stdout.end(samples(values)); children[index].process.emit('close', 0) }
async function cacheDirectory(): Promise<string> { return fs.mkdtemp(path.join(os.tmpdir(), 'henji-waveform-cache-')) }
function cachedService(directory: string | null, identity = async (source: string) => ({ path: source, identity: 'file-v1' })): ReturnType<typeof createAudioWaveformService> {
  return createAudioWaveformService({ ffmpegPath: async () => 'mpeg', ffprobePath: async () => 'probe', identity, createWorker: worker, diskCache: directory ? createContentDiskCache({ directory: () => directory, extension: '.hwpk' }) : null })
}
beforeEach(() => { vi.resetAllMocks(); children = [] })

describe('whole-source multi-resolution waveform (task 2.3)', () => {
  it('decodes a stereo stream once on the absolute clock and serves stereo, mono mix, single channel and legacy views; a new session hits the disk cache', async () => {
    probeWith([{ codec_type: 'audio', sample_rate: '48000', channels: 2, duration: '0.01' }])
    const directory = await cacheDirectory()
    const source = localMedia('stereo.wav')
    const analyzer = cachedService(directory)
    const stereo = analyzer.extractPyramid({ source, channels: 2 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const { args } = children[0]
    expect(args[args.indexOf('-ac') + 1]).toBe('2'); expect(args.join(' ')).not.toContain('pan=')
    expect(args).toContain('aresample=48000:async=1:first_pts=0,atrim=end_sample=480,asetpts=PTS-STARTPTS')
    finish(0, Array.from({ length: 480 }, () => [0.5, -0.25]).flat())
    const result = pyramid(await stereo)
    expect(result).toMatchObject({ sampleRate: 48000, frameCount: 480, channelCount: 2 })
    expect(result.peakMax).toBeCloseTo(0.5, 4)
    expect(result.levels[0].peak).toHaveLength(2); expect(result.levels[0].peak[0]).toBeInstanceOf(Uint16Array)
    const mono = pyramid(await analyzer.extractPyramid({ source, channels: 1 }))
    const right = pyramid(await analyzer.extractPyramid({ source, channels: 1, audioChannel: 1 }))
    expect(mono.peakMax).toBeCloseTo(0.125, 4); expect(right.peakMax).toBeCloseTo(0.25, 4)
    expect(mono.version).not.toBe(result.version)
    const legacy = await analyzer.extractSamples(source, 4)
    expect(legacy.peak.every(value => Math.abs(value - 0.125) < 1e-4)).toBe(true)
    await expect(analyzer.extractPyramid({ source, channels: 1, audioChannel: 2 })).rejects.toThrow('只有 2 个声道')
    expect(children).toHaveLength(1)
    await analyzer.dispose()
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.hwpk'))).toHaveLength(1)
    const next = cachedService(directory)
    const reopened = pyramid(await next.extractPyramid({ source, channels: 2 }))
    expect(reopened.version).toBe(result.version); expect([...reopened.levels[0].rms[1]]).toEqual([...result.levels[0].rms[1]])
    expect(await next.extractPyramid({ source, channels: 2, ifNoneMatch: result.version })).toEqual({ notModified: true, version: result.version })
    expect(children).toHaveLength(1)
    await next.dispose(); await fs.rm(directory, { recursive: true, force: true })
  })
  it('a changed file is a different version and decodes again; maxBuckets keeps only coarse levels', async () => {
    probeWith([{ codec_type: 'audio', sample_rate: '8000', channels: 1, duration: '30' }], '30')
    const directory = await cacheDirectory()
    let version = 'a'
    const analyzer = cachedService(directory, async source => ({ path: source, identity: version }))
    const source = localMedia('long.wav')
    const first = analyzer.extractPyramid({ source, channels: 2, maxBuckets: 300 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    finish(0, Array(8000 * 30).fill(0.2))
    const coarse = pyramid(await first)
    expect(coarse.channelCount).toBe(1)
    expect(coarse.levels.every(level => level.bucketCount <= 300)).toBe(true)
    const full = pyramid(await analyzer.extractPyramid({ source, channels: 2 }))
    expect(full.levels.map(level => level.samplesPerBucket)).toEqual([128, 1024])
    version = 'b'
    const changed = analyzer.extractPyramid({ source, channels: 2, ifNoneMatch: full.version })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    finish(1, Array(8000 * 30).fill(0.4))
    const refreshed = pyramid(await changed)
    expect(refreshed.version).not.toBe(full.version); expect(refreshed.peakMax).toBeCloseTo(0.4, 4)
    await analyzer.dispose(); await fs.rm(directory, { recursive: true, force: true })
  })
  it('replaces an invalid cache file instead of failing', async () => {
    probeWith([{ codec_type: 'audio', sample_rate: '48000', channels: 1, duration: '0.01' }])
    const directory = await cacheDirectory()
    const source = localMedia('mono.wav')
    const first = cachedService(directory)
    const pending = first.extractPyramid({ source, channels: 1 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    finish(0, Array(480).fill(0.5))
    await pending; await first.dispose()
    const [file] = (await fs.readdir(directory)).filter(name => name.endsWith('.hwpk'))
    await fs.writeFile(path.join(directory, file), Buffer.from('HWPK broken'))
    const second = cachedService(directory)
    const again = second.extractPyramid({ source, channels: 1 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    finish(1, Array(480).fill(0.5))
    expect(pyramid(await again).peakMax).toBeCloseTo(0.5, 4)
    expect((await fs.stat(path.join(directory, file))).size).toBeGreaterThan(64)
    await second.dispose(); await fs.rm(directory, { recursive: true, force: true })
  })
  it('streams with more than two channels decode per selection with FFmpeg downmix or channel pick', async () => {
    probeWith([{ codec_type: 'audio', sample_rate: '48000', channels: 6, duration: '0.01' }])
    const analyzer = cachedService(null, async source => ({ path: source, identity: 'surround' }))
    const source = localMedia('surround.mov')
    const centre = analyzer.extractPyramid({ source, channels: 1, audioChannel: 2 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    expect(children[0].args).toContain('pan=mono|c0=c2,aresample=48000:async=1:first_pts=0,atrim=end_sample=480,asetpts=PTS-STARTPTS')
    finish(0, Array(480).fill(0.3))
    expect(pyramid(await centre).channelCount).toBe(1)
    const mix = analyzer.extractPyramid({ source, channels: 2 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    expect(children[1].args[children[1].args.indexOf('-ac') + 1]).toBe('2'); expect(children[1].args.join(' ')).not.toContain('pan=')
    finish(1, Array(960).fill(0.1))
    expect(pyramid(await mix).channelCount).toBe(2)
    await analyzer.dispose()
  })
  it('returns the signed samples of a short detail range and refuses detail ranges above the readback limit', async () => {
    probeWith([{ codec_type: 'audio', sample_rate: '48000', channels: 2 }], '1800')
    const analyzer = cachedService(null)
    const request = { source: localMedia('source.wav'), startUs: 500000, endUs: 501000, bucketCount: 16, channels: 2 as const, samples: true }
    const detail = analyzer.extractRange(request)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    finish(0, Array.from({ length: 48 }, (_, frame) => [frame % 2 ? -0.5 : 0.5, 0.25]).flat())
    const result = await detail
    expect(result.channels[0].samples).toBeInstanceOf(Float32Array)
    expect([...result.channels[0].samples!.slice(0, 3)]).toEqual([0.5, -0.5, 0.5])
    await expect(analyzer.extractRange({ ...request, startUs: 0, endUs: 10_000_000 })).rejects.toThrow('精细波形范围过长')
    await analyzer.dispose()
  })
})
