import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const platform = vi.hoisted(() => ({ audioEdit: { extractWaveformPyramid: vi.fn(), extractWaveformRange: vi.fn() } }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => platform }))
import type { AudioWaveformPyramid, AudioWaveformPyramidRequest, AudioWaveformPyramidResult, AudioWaveformRangeResult } from '@/platform/contracts/audioWaveform'
import { acquireWaveform, acquireWaveformDetail, planWaveformDetailWindow, readWaveformDetail, readWaveformState, resetWaveformDataForTests, waveformDetailKey, WAVEFORM_OVERVIEW_MAX_BUCKETS } from './waveformDataService'

function pyramid(version = 'v1', peakMax = 0.5): AudioWaveformPyramid {
  return { version, sampleRate: 48000, frameCount: 48000, startSeconds: 0, endSeconds: 1, amplitudeScale: 1, peakMax, channelCount: 1, levels: [{ samplesPerBucket: 128, bucketCount: 375, peak: [new Uint16Array(375)], rms: [new Uint16Array(375)] }] }
}
interface Call { request: AudioWaveformPyramidRequest; signal: AbortSignal; resolve: (value: AudioWaveformPyramidResult) => void; reject: (error: unknown) => void }
let calls: Call[]
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
beforeEach(() => {
  calls = []
  platform.audioEdit.extractWaveformPyramid.mockImplementation((request: AudioWaveformPyramidRequest, signal: AbortSignal) => new Promise<AudioWaveformPyramidResult>((resolve, reject) => { calls.push({ request, signal, resolve, reject }) }))
})
afterEach(() => { resetWaveformDataForTests(); vi.resetAllMocks(); vi.useRealTimers() })

describe('renderer waveform data service', () => {
  it('shares one request per source, normalises once per source and cancels when the last user leaves', async () => {
    const ref = { source: 'D:/a.wav', channels: 2 as const }
    const releaseA = acquireWaveform(ref, 'full'); const releaseB = acquireWaveform({ ...ref, audioStream: 0 }, 'full')
    expect(calls).toHaveLength(1)
    expect(calls[0].request).toEqual({ source: 'D:/a.wav', channels: 2 })
    expect(readWaveformState(ref, 'full').status).toBe('loading')
    releaseA(); expect(calls[0].signal.aborted).toBe(false)
    releaseB(); expect(calls[0].signal.aborted).toBe(true)
    expect(readWaveformState(ref, 'full').status).toBe('idle')
    const again = acquireWaveform(ref, 'full')
    calls[1].resolve(pyramid('v1', 0.25)); await flush()
    const state = readWaveformState(ref, 'full')
    expect(state.status).toBe('ready'); expect(state.data!.gain).toBe(4)
    // An overview user of the same source reuses the full data without a request.
    const overview = acquireWaveform(ref, 'overview')
    expect(readWaveformState(ref, 'overview').data).toBe(state.data)
    expect(calls).toHaveLength(2)
    overview(); again()
  })
  it('limits concurrent requests and asks overview users only for coarse levels', async () => {
    const releases = Array.from({ length: 6 }, (_, index) => acquireWaveform({ source: `D:/${index}.wav`, channels: 1 }, 'overview'))
    expect(calls).toHaveLength(4)
    expect(calls[0].request.maxBuckets).toBe(WAVEFORM_OVERVIEW_MAX_BUCKETS)
    calls[0].reject(new Error('素材已删除')); await flush()
    expect(calls).toHaveLength(5)
    expect(readWaveformState({ source: 'D:/0.wav', channels: 1 }, 'overview')).toEqual({ status: 'error', error: '素材已删除' })
    releases[5](); calls[1].resolve(pyramid()); await flush()
    expect(calls).toHaveLength(5)
    releases.forEach(release => release())
  })
  it('revalidates a held waveform with its version after a while and keeps it when unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ref = { source: 'D:/b.wav', channels: 1 as const }
    const first = acquireWaveform(ref, 'full')
    calls[0].resolve(pyramid('v1')); await flush()
    first()
    vi.setSystemTime(Date.now() + 11_000)
    const second = acquireWaveform(ref, 'full')
    expect(calls[1].request.ifNoneMatch).toBe('v1')
    const held = readWaveformState(ref, 'full').data
    calls[1].resolve({ notModified: true, version: 'v1' }); await flush()
    expect(readWaveformState(ref, 'full').data).toBe(held)
    second()
    vi.setSystemTime(Date.now() + 11_000)
    const third = acquireWaveform(ref, 'full')
    calls[2].resolve(pyramid('v2', 1)); await flush()
    expect(readWaveformState(ref, 'full').data!.pyramid.version).toBe('v2')
    third()
  })
  it('plans aligned detail windows around the view and reads signed samples sample-accurately', async () => {
    expect(planWaveformDetailWindow(48000 * 60, 100_000, 101_000)).toEqual({ start: 90112, end: 110592 })
    expect(planWaveformDetailWindow(48000 * 60, 0, 300_000)).toBeUndefined()
    const window = planWaveformDetailWindow(48000, 47_900, 48_000)!
    expect(window.end).toBe(48000)
    const ref = { source: 'D:/c.wav', channels: 1 as const }
    const release = acquireWaveform(ref, 'full')
    calls[0].resolve(pyramid()); await flush()
    const data = readWaveformState(ref, 'full').data!
    const range = platform.audioEdit.extractWaveformRange.mockImplementation(async (request: { startUs: number; endUs: number }) => ({ startUs: request.startUs, endUs: request.endUs, durationSeconds: 1, sampleRate: 48000, channelCount: 1, fileIdentity: 'f', channels: [{ peak: [], rms: [], sampleCounts: [], samples: new Float32Array(4096).fill(0.5) }] } as AudioWaveformRangeResult))
    const releaseDetail = acquireWaveformDetail(data, 4096, 8192)
    expect(range.mock.calls[0][0]).toMatchObject({ source: 'D:/c.wav', channels: 1, startUs: Math.floor(4096 * 1e6 / 48000), endUs: Math.floor(8192 * 1e6 / 48000), samples: true })
    await flush()
    expect(readWaveformDetail(waveformDetailKey(data, 4096, 8192))).toMatchObject({ firstFrame: 4096, frameCount: 4096 })
    releaseDetail(); release()
  })
})
