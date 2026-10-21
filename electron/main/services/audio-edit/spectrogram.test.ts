import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const state = vi.hoisted(() => ({ directory: '', digest: 'one', calls: 0, edited: 'repair-one.wav' }))
vi.mock('./render', () => ({ prepareAudioEditRenderSource: async () => state.edited }))
vi.mock('./project-store', () => ({ requireAudioEditProject: async () => ({ id: 'p', source: { sourcePath: 'source', sampleRate: 48000, channels: 2, durationFrames: 4800000 } }) }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.directory, verifyAudioEditSource: vi.fn(), identifyAudioEditSource: async () => ({ digest: state.digest }), prepareAudioEditAudio: async () => 'decoded.wav' }))
vi.mock('./task-store', () => ({ runAudioEditTask: async (_id: string, _kind: string, run: (signal: AbortSignal) => Promise<unknown>, _requestId: string, _input: string, readOnly: boolean) => {
  expect(readOnly).toBe(true)
  const result = await run(new AbortController().signal)
  expect(typeof result).toBe('string')
  return JSON.parse(JSON.stringify(result)) as unknown
} }))
vi.mock('./dsp-adapter', () => ({ runSpectrogram: async (_input: string, output: string, options: { startFrame: number; endFrame: number; channel?: number; fftSize: number; hop: number }) => {
  state.calls++
  await fs.writeFile(output, JSON.stringify({ ...options, sampleRate: 48000, channels: options.channel === undefined ? 2 : 1, timeBins: 1, frequencyBins: options.fftSize / 2 + 1, values: Buffer.from([0, 127, 255]).toString('base64') }))
} }))
import { getAudioEditSpectrogram } from './spectrogram'
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-spectrum-')); state.calls = 0; state.digest = 'one' })
afterEach(async () => { await fs.rm(state.directory, { recursive: true, force: true }) })
it('bounds long requests, reuses source/parameter cache, and returns typed samples with continuation', async () => {
  const request = { projectId: 'p', startFrame: 0, endFrame: 4800000 }
  const first = await getAudioEditSpectrogram(request)
  expect(first.endFrame).toBe(480000); expect(first.values).toEqual(new Uint8Array([0, 127, 255]))
  await getAudioEditSpectrogram(request); expect(state.calls).toBe(1)
  await getAudioEditSpectrogram({ ...request, startFrame: first.endFrame }); expect(state.calls).toBe(2)
  await getAudioEditSpectrogram({ ...request, channel: 0 }); expect(state.calls).toBe(3)
  state.digest = 'two'; await getAudioEditSpectrogram(request); expect(state.calls).toBe(4)
  await getAudioEditSpectrogram({ ...request, mode: 'edited' }); expect(state.calls).toBe(5)
  state.edited = 'repair-two.wav'; await getAudioEditSpectrogram({ ...request, mode: 'edited' }); expect(state.calls).toBe(6)
  await expect(getAudioEditSpectrogram({ ...request, channel: 2 })).rejects.toThrow('声道')
  await expect(getAudioEditSpectrogram({ ...request, startFrame: 4800000, endFrame: 4800001 })).rejects.toThrow('超出')
})
