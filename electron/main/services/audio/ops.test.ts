import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioWaveformAggregator } from './waveform-worker'
import type { AudioWaveformAggregationOptions } from './types'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), error: vi.fn() }) }))
vi.mock('../media/shared', () => ({ resolveLocalMediaPath: async (source: string) => source }))
vi.mock('../image/source', () => ({ normalizeLocalSource: (source: string) => source }))
import { createAudioWaveformService, audioWaveformAbsoluteEndSeconds, audioWaveformSampleIndex, validateAudioWaveformRange } from './ops'

class Process extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
  closed = false
  close(code = 0): void {
    if (this.closed) return
    this.closed = true; this.stdout.end(); this.stderr.end(); this.emit('close', code)
  }
}
function worker(): { start: (options: AudioWaveformAggregationOptions) => Promise<void>; push: (chunk: Uint8Array) => Promise<void>; finish: () => Promise<ReturnType<AudioWaveformAggregator['finish']>>; dispose: () => Promise<void> } {
  let aggregate: AudioWaveformAggregator
  return {
    start: async options => { aggregate = new AudioWaveformAggregator(options) },
    push: async chunk => { aggregate.push(chunk) },
    finish: async () => aggregate.finish(),
    dispose: vi.fn(async () => undefined),
  }
}
const request = { source: 'D:/source.wav', startUs: 0, endUs: 1000, bucketCount: 16, channels: 2 as const }
let children: Array<{ process: Process; args: string[] }>
beforeEach(() => {
  vi.resetAllMocks(); children = []
  mocks.spawn.mockImplementation((binary: string, args: string[]) => {
    const child = new Process()
    if (binary === 'probe') queueMicrotask(() => {
      child.stdout.end(JSON.stringify({ format: { duration: '1800' }, streams: [{ codec_type: 'audio', sample_rate: '48000', channels: 2 }] }))
      child.emit('close', 0)
    })
    else children.push({ process: child, args })
    return child
  })
})
function service(identity = async (source: string) => ({ path: source, identity: 'file-v1' })): ReturnType<typeof createAudioWaveformService> {
  return createAudioWaveformService({ ffmpegPath: async () => 'mpeg', ffprobePath: async () => 'probe', identity, createWorker: worker })
}
function samples(values: number[]): Buffer { const bytes = Buffer.alloc(values.length * 4); values.forEach((value, index) => bytes.writeFloatLE(value, index * 4)); return bytes }

describe('waveform extraction lifecycle and time bounds', () => {
  it('validates integers, half-open rounding, max duration, and refuses remote range without decoding', async () => {
    expect(audioWaveformSampleIndex(123457, 44100)).toBe(5445)
    expect(audioWaveformSampleIndex(223457, 44100)).toBe(9855)
    for (const change of [{ startUs: -1 }, { endUs: 0 }, { startUs: 0.1 }, { endUs: 1800_000_001 }, { bucketCount: 15 }, { bucketCount: 4097 }, { channels: 3 }, { sourceRevision: null }, { source: 'https://example.test/audio.wav' }, { source: 'relative.wav' }]) expect(() => validateAudioWaveformRange({ ...request, ...change } as typeof request)).toThrow()
    const analyzer = service()
    expect(() => analyzer.extractRange({ ...request, endUs: 1800_000_001 })).toThrow('30分钟')
    expect(mocks.spawn).not.toHaveBeenCalled(); await analyzer.dispose()
  })
  it('streams actual split stereo samples and bounds decoding to range+100ms preroll+two end samples', async () => {
    const analyzer = service()
    const pending = analyzer.extractRange({ ...request, startUs: 500000, endUs: 501000 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const { process, args } = children[0]
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(Number(args[args.indexOf('-ss') + 1])).toBe(0.4)
    expect(Number(args[args.indexOf('-t') + 1])).toBeLessThan(0.102)
    expect(args).toContain('aresample=48000:async=1:first_pts=24000,atrim=end_sample=48,asetpts=PTS-STARTPTS')
    const data = samples(Array.from({ length: 48 }, () => [0.5, 2]).flat())
    process.stdout.write(data.subarray(0, 7)); process.stdout.end(data.subarray(7)); process.emit('close', 0)
    const output = await pending
    expect(output.channels[0].rms).toEqual(Array(16).fill(0.5)); expect(output.channels[1].peak).toEqual(Array(16).fill(2))
    expect(output.channels[0].sampleCounts).toEqual(Array(16).fill(3))
    await analyzer.dispose()
  })
  it('validates and seeks on the absolute source clock when the container starts after zero', async () => {
    // MPEG-PS sample: container 0.523344+3.079756, picture 0.533367+3.069733 (absolute end 3.6031), sound 0.523344+3.
    const probe = { format: { start_time: '0.523344', duration: '3.079756' }, streams: [
      { codec_type: 'video', start_time: '0.533367', duration: '3.069733', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', sample_rate: '48000', channels: 2, start_time: '0.523344', duration: '3.000000', disposition: { attached_pic: 0 } },
      { codec_type: 'video', start_time: '0', duration: '9', disposition: { attached_pic: 1 } },
    ] }
    expect(audioWaveformAbsoluteEndSeconds(probe.streams, probe.format)).toBeCloseTo(3.6031, 9)
    expect(audioWaveformAbsoluteEndSeconds([{ codec_type: 'data', start_time: '0', duration: '9' }], { start_time: '1.5', duration: '2' })).toBe(3.5)
    mocks.spawn.mockImplementation((binary: string, args: string[]) => {
      const child = new Process()
      if (binary === 'probe') queueMicrotask(() => { child.stdout.end(JSON.stringify(probe)); child.emit('close', 0) })
      else children.push({ process: child, args })
      return child
    })
    const analyzer = service()
    const whole = analyzer.extractRange({ ...request, startUs: 0, endUs: 3_603_100 })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const { process, args } = children[0]
    expect(args).toContain('-copyts'); expect(args).not.toContain('-start_at_zero')
    expect(Number(args[args.indexOf('-ss') + 1])).toBe(0)
    expect(args).toContain(`aresample=48000:async=1:first_pts=0,atrim=end_sample=${audioWaveformSampleIndex(3_603_100, 48000)},asetpts=PTS-STARTPTS`)
    process.stdout.end(samples(Array(96).fill(0.5))); process.emit('close', 0)
    expect((await whole).durationSeconds).toBeCloseTo(3.6031, 9)
    const sought = analyzer.extractRange({ ...request, startUs: 2_000_000, endUs: 2_100_000 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    // Absolute 1.9s preroll is 1.376656s after the container start, FFmpeg's -ss origin.
    expect(Number(children[1].args[children[1].args.indexOf('-ss') + 1])).toBeCloseTo(1.376656, 9)
    children[1].process.stdout.end(samples(Array(96).fill(0.5))); children[1].process.emit('close', 0)
    await sought
    await expect(analyzer.extractRange({ ...request, startUs: 3_000_000, endUs: 3_605_000 })).rejects.toThrow('超出素材时长')
    await analyzer.dispose()
  })
  it('retains permits after cancellation until child/stdIo close; queued work and dispose remain bounded', async () => {
    const analyzer = service()
    const a = new AbortController(); const b = new AbortController()
    const first = analyzer.extractRange({ ...request, source: 'D:/a.wav', endUs: 1800_000_000 }, a.signal).catch(error => error)
    const second = analyzer.extractRange({ ...request, source: 'D:/b.wav' }, b.signal).catch(error => error)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const third = analyzer.extractRange({ ...request, source: 'D:/c.wav' }).catch(error => error)
    await vi.waitFor(() => expect(analyzer.statistics().queued).toBe(1))
    a.abort(); b.abort()
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(await second).toMatchObject({ name: 'AbortError' })
    expect(children.every(child => child.process.kill.mock.calls.length === 1)).toBe(true)
    expect(analyzer.statistics()).toMatchObject({ active: 2, queued: 1 })
    let ended = false
    const disposed = analyzer.dispose().then(() => { ended = true })
    expect(await third).toMatchObject({ name: 'AbortError' })
    await Promise.resolve(); expect(ended).toBe(false)
    children[0].process.close(); children[1].process.close()
    await disposed
    expect(analyzer.statistics()).toMatchObject({ active: 0, queued: 0 })
    expect(children).toHaveLength(2)
  })
  it('rejects nonfinite PCM and waits for killed process close before freeing resources', async () => {
    const analyzer = service()
    const result = analyzer.extractRange(request).catch(error => error)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0].process.stdout.write(samples([NaN, 0]))
    await vi.waitFor(() => expect(children[0].process.kill).toHaveBeenCalled())
    expect(analyzer.statistics().active).toBe(1)
    children[0].process.close()
    expect(await result).toMatchObject({ message: expect.stringContaining('非有限') })
    await analyzer.dispose()
  })
  it('rejects changed source at final identity check and allows retry on the new file', async () => {
    let version = 'original'
    const analyzer = service(async source => ({ path: source, identity: version }))
    const result = analyzer.extractRange(request).catch(error => error)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    version = 'updated'; children[0].process.stdout.end(samples(Array(96).fill(0.5))); children[0].process.emit('close', 0)
    expect(await result).toMatchObject({ message: expect.stringContaining('变化') })
    expect(analyzer.statistics().cacheEntries).toBe(0)
    const retry = analyzer.extractRange(request)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    children[1].process.stdout.end(samples(Array(96).fill(0.5))); children[1].process.emit('close', 0)
    expect((await retry).fileIdentity).toBe('updated')
    await analyzer.dispose()
  })
  it('keeps legacy downloads within shared permits even when an aborted download finishes late', async () => {
    const resolvers: Array<(path: string) => void> = []
    const signals: AbortSignal[] = []
    const resolvePath = vi.fn((_source: string, signal?: AbortSignal) => { signals.push(signal!); return new Promise<string>(resolve => resolvers.push(resolve)) })
    const analyzer = createAudioWaveformService({ resolvePath, identity: async source => ({ path: source, identity: 'temp' }), ffmpegPath: async () => 'mpeg', ffprobePath: async () => 'probe', createWorker: worker })
    const abort = new AbortController()
    const first = analyzer.extractSamples('https://example.test/a.wav', 16, abort.signal).catch(error => error)
    const second = analyzer.extractSamples('https://example.test/b.wav', 16).catch(error => error)
    const third = analyzer.extractSamples('https://example.test/c.wav', 16).catch(error => error)
    await vi.waitFor(() => expect(resolvePath).toHaveBeenCalledTimes(2))
    abort.abort(); expect(await first).toMatchObject({ name: 'AbortError' })
    expect(signals[0].aborted).toBe(true)
    expect(analyzer.statistics()).toMatchObject({ active: 2, queued: 1 })
    const disposed = analyzer.dispose()
    expect(await second).toMatchObject({ name: 'AbortError' }); expect(await third).toMatchObject({ name: 'AbortError' })
    resolvers.forEach(resolve => resolve(path.join(os.tmpdir(), `henji-waveform-missing-${randomUUID()}.wav`)))
    await disposed
    expect(children).toHaveLength(0)
    expect(analyzer.statistics()).toMatchObject({ active: 0, queued: 0, cacheBytes: 0 })
  })
  it('does not swallow final chunk failures arriving after native close', async () => {
    let fail!: (reason: Error) => void
    const isolated = worker()
    isolated.push = () => new Promise<void>((_resolve, reject) => { fail = reject })
    const analyzer = createAudioWaveformService({ identity: async source => ({ path: source, identity: 'same' }), ffmpegPath: async () => 'mpeg', ffprobePath: async () => 'probe', createWorker: () => isolated })
    const result = analyzer.extractRange(request).catch(error => error)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0].process.stdout.end(samples([1, 0]))
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    children[0].process.emit('close', 0)
    fail(new Error('late aggregation failure'))
    expect(await result).toMatchObject({ message: 'late aggregation failure' })
    expect(analyzer.statistics().cacheEntries).toBe(0)
    await analyzer.dispose()
  })
})
