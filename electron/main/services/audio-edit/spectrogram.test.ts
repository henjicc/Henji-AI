import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const state = vi.hoisted(() => ({ directory: '', digest: 'one', calls: 0, edited: 'repair-one.wav', fail: false }))
vi.mock('./render', () => ({ prepareAudioEditRenderSource: async () => state.edited }))
vi.mock('./project-store', () => ({ requireAudioEditProject: async () => ({ id: 'p', source: { sourcePath: 'source', sampleRate: 48000, channels: 2, durationFrames: 4800000 } }) }))
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.directory, verifyAudioEditSource: vi.fn(), identifyAudioEditSource: async () => ({ digest: state.digest }), prepareAudioEditAudio: async () => 'decoded.wav' }))
vi.mock('./task-store', () => ({ runAudioEditTask: async (_id: string, _kind: string, run: (signal: AbortSignal) => Promise<unknown>, _requestId: string, _input: string, readOnly: boolean) => {
  expect(readOnly).toBe(true)
  const result = await run(new AbortController().signal)
  expect(Array.isArray(result)).toBe(true)
  return JSON.parse(JSON.stringify(result)) as unknown
} }))
vi.mock('./audio-worker-client', () => ({ invokeAudioWorker: async (options: { output_path: string; start_frame: number; end_frame: number; channel?: number; fft_size: number; hop: number }) => {
  state.calls++
  if (state.fail) throw new Error('模拟 Worker 失败')
  const m = { sampleRate: 48000, channels: options.channel === undefined ? 2 : 1, frames: Math.ceil((options.end_frame - options.start_frame) / options.hop), bins: options.fft_size / 2 + 1, startFrame: options.start_frame, endFrame: options.end_frame, fftSize: options.fft_size, hop: options.hop }
  const bytes = new Uint8Array(64 + m.channels * m.frames * m.bins), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('HJSP')); view.setUint16(4, 1, true); view.setUint16(6, 64, true)
  for (const [offset, value] of [[8, m.sampleRate], [12, m.channels], [16, m.fftSize], [20, m.hop], [32, m.bins]]) view.setUint32(offset, value, true)
  view.setBigUint64(24, BigInt(m.frames), true); view.setBigUint64(40, BigInt(m.startFrame), true); view.setBigUint64(48, BigInt(m.endFrame), true)
  for (let channel = 0; channel < m.channels; channel++) bytes.fill(127 + channel, 64 + channel * m.frames * m.bins, 64 + (channel + 1) * m.frames * m.bins)
  await fs.writeFile(options.output_path, bytes)
  return m
} }))
import { getAudioEditSpectrogram, spectrogramTileKey } from './spectrogram'
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-spectrum-')); state.calls = 0; state.digest = 'one'; state.edited = 'repair-one.wav'; state.fail = false })
afterEach(async () => { await fs.rm(state.directory, { recursive: true, force: true }) })
it('范围请求按固定块对齐、控制 IPC 大小，平移复用重叠块并保持声道顺序', async () => {
  const request = { projectId: 'p', startFrame: 100, endFrame: 4800000 }
  const first = await getAudioEditSpectrogram(request)
  expect(first.startFrame).toBe(0); expect(first.endFrame).toBe(3 * 1024 * 512)
  expect(first.values.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
  expect(first.values[0]).toBe(127); expect(first.values[first.timeBins * first.frequencyBins]).toBe(128)
  expect(state.calls).toBe(3)
  await getAudioEditSpectrogram({ ...request, startFrame: 500 }); expect(state.calls).toBe(3)
  await getAudioEditSpectrogram({ ...request, startFrame: 1024 * 512 + 7 }); expect(state.calls).toBe(4)
  const files = await fs.readdir(state.directory)
  for (const file of files) expect((await fs.readFile(path.join(state.directory, file))).subarray(0, 4).toString()).toBe('HJSP')
  const tail = await getAudioEditSpectrogram({ ...request, startFrame: 4799999 })
  expect(tail.endFrame).toBe(4800000)
})
it('源、处理结果、声道和精度隔离缓存，失败不会发布半块', async () => {
  const request = { projectId: 'p', startFrame: 0, endFrame: 100 }
  await getAudioEditSpectrogram(request); expect(state.calls).toBe(1)
  await getAudioEditSpectrogram({ ...request, channel: 0 }); expect(state.calls).toBe(2)
  state.digest = 'two'; await getAudioEditSpectrogram(request); expect(state.calls).toBe(3)
  await getAudioEditSpectrogram({ ...request, mode: 'edited' }); expect(state.calls).toBe(4)
  state.edited = 'repair-two.wav'; await getAudioEditSpectrogram({ ...request, mode: 'edited' }); expect(state.calls).toBe(5)
  state.fail = true
  await expect(getAudioEditSpectrogram({ ...request, hop: 128 })).rejects.toThrow('Worker')
  state.fail = false
  await getAudioEditSpectrogram({ ...request, hop: 128 }); expect(state.calls).toBe(7)
  await expect(getAudioEditSpectrogram({ ...request, channel: 2 })).rejects.toThrow('声道')
  await expect(getAudioEditSpectrogram({ ...request, startFrame: 4800000, endFrame: 4800001 })).rejects.toThrow('超出')
})
it('块 key 不依赖视口，且所有计算参数均参与身份', () => {
  const key = spectrogramTileKey('source', 'source', undefined, 2048, 512, undefined, 0)
  expect(spectrogramTileKey('source', 'source', undefined, 2048, 512, undefined, 0)).toBe(key)
  expect(spectrogramTileKey('source', 'source', undefined, 2048, 512, undefined, 0, 1024)).not.toBe(key)
  expect(spectrogramTileKey('source', 'source', undefined, 2048, 512, undefined, 0, 2048, true)).not.toBe(key)
  for (const candidate of [spectrogramTileKey('other', 'source', undefined, 2048, 512, undefined, 0), spectrogramTileKey('source', 'edited', 'v2', 2048, 512, undefined, 0), spectrogramTileKey('source', 'source', undefined, 4096, 512, undefined, 0), spectrogramTileKey('source', 'source', undefined, 2048, 256, undefined, 0), spectrogramTileKey('source', 'source', undefined, 2048, 512, 0, 0), spectrogramTileKey('source', 'source', undefined, 2048, 512, undefined, 1)]) expect(candidate).not.toBe(key)
})
