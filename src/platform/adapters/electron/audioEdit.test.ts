// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronAudioEdit } from './audioEdit'
import type { AudioWaveformRangeRequest } from '@/platform/contracts/audioWaveform'

afterEach(() => { vi.unstubAllGlobals() })
const request = { source: 'C:/media.wav', startUs: 0, endUs: 1000, bucketCount: 16, channels: 2 as const }
const result = { ...request, sampleRate: 48000, durationSeconds: 1, channelCount: 2 as const, channels: [], fileIdentity: 'file' }

describe('audio waveform range PAL', () => {
  it('retains requestId for native cancellation and ignores late native completion', async () => {
    let finish!: (value: typeof result) => void
    const extractRangeSamples = vi.fn<[AudioWaveformRangeRequest & { requestId: string }], Promise<typeof result>>(() => new Promise<typeof result>(resolve => { finish = resolve }))
    const cancelExtractSamples = vi.fn(async () => undefined)
    vi.stubGlobal('window', { henjiNative: { audio: { extractRangeSamples, cancelExtractSamples } } })
    const controller = new AbortController()
    const pending = createElectronAudioEdit().extractWaveformRange(request, controller.signal)
    const id = extractRangeSamples.mock.calls[0][0].requestId
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelExtractSamples).toHaveBeenCalledWith(id)
    finish(result)
    await Promise.resolve()
    expect(cancelExtractSamples).toHaveBeenCalledTimes(1)
  })
  it('supports success, does no native work when already aborted, and preserves legacy arguments', async () => {
    const extractRangeSamples = vi.fn(async () => result)
    const extractSamples = vi.fn(async () => ({ peak: [], rms: [], durationSeconds: 1 }))
    vi.stubGlobal('window', { henjiNative: { audio: { extractRangeSamples, extractSamples, cancelExtractSamples: vi.fn() } } })
    const platform = createElectronAudioEdit()
    expect(await platform.extractWaveformRange(request)).toEqual(result)
    const controller = new AbortController(); controller.abort()
    expect(() => platform.extractWaveformRange(request, controller.signal)).toThrow()
    expect(extractRangeSamples).toHaveBeenCalledTimes(1)
    await platform.extractWaveform('legacy', 1600)
    expect(extractSamples).toHaveBeenCalledWith({ source: 'legacy', bucketCount: 1600 })
  })
})
