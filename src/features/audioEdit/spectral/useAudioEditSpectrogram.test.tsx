/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AudioEditSpectrogramChunk, AudioEditSpectrogramRequest } from '@/core/audioEdit/regions'
import { chunkToSpectrogram, planSpectrogramRequest, useAudioEditSpectrogram } from './useAudioEditSpectrogram'
import { spectrogramTileColumns } from '@/core/audioEdit/spectrogramTiles'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../application/audioEditRegions', () => ({ getAudioEditSpectrogram: mocks.request }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })
const duration = 10_000_000
function chunk(request: AudioEditSpectrogramRequest): AudioEditSpectrogramChunk {
  const hop = request.hop!, timeBins = Math.ceil((request.endFrame - request.startFrame) / hop)
  return { startFrame: request.startFrame, endFrame: request.endFrame, sampleRate: 48000, channels: 1, fftSize: 2048, hop, frequencyBins: 3, timeBins, values: new Uint8Array(timeBins * 3) }
}
const settle = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
it('预热总览、范围内平移不重取，跨块后返回复用 LRU，尺寸稳定 150ms 才改变 hop', async () => {
  vi.useFakeTimers()
  mocks.request.mockImplementation(async (request: AudioEditSpectrogramRequest) => chunk(request))
  const { result, rerender } = renderHook(({ start, columns }) => useAudioEditSpectrogram('p', { start, end: start + 200000 }, columns, duration, 'source', 0), { initialProps: { start: 0, columns: 1000 } })
  await settle()
  expect(result.current.status).toBe('ready')
  expect(mocks.request.mock.calls.some(([request]) => request.startFrame === 0 && request.endFrame === duration)).toBe(true)
  const count = mocks.request.mock.calls.length, initial = result.current.data
  rerender({ start: 1000, columns: 1000 }); await settle()
  expect(mocks.request).toHaveBeenCalledTimes(count); expect(result.current.data).toBe(initial)
  rerender({ start: 2_000_000, columns: 1000 }); await settle()
  const afterPan = mocks.request.mock.calls.length
  expect(afterPan).toBeGreaterThan(count)
  rerender({ start: 0, columns: 1000 }); await settle()
  expect(mocks.request).toHaveBeenCalledTimes(afterPan)
  rerender({ start: 0, columns: 100 }); await act(async () => { await vi.advanceTimersByTimeAsync(149) })
  expect(mocks.request).toHaveBeenCalledTimes(afterPan)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(mocks.request.mock.calls.length).toBeGreaterThan(afterPan)
})
it('等待新视口期间保持旧图，过时请求不能覆盖新项目', async () => {
  vi.useFakeTimers()
  mocks.request.mockImplementation(async (request: AudioEditSpectrogramRequest) => chunk(request))
  const { result, rerender } = renderHook(({ id, start }) => useAudioEditSpectrogram(id, { start, end: start + 10000 }, 1000, duration, 'source', 0), { initialProps: { id: 'p', start: 0 } })
  await settle()
  const initial = result.current.data
  let release: (() => void) | undefined
  mocks.request.mockImplementationOnce((request: AudioEditSpectrogramRequest) => new Promise<AudioEditSpectrogramChunk>(resolve => { release = () => resolve(chunk(request)) }))
  rerender({ id: 'p', start: 5_000_000 }); await settle()
  expect(result.current.status).toBe('loading'); expect(result.current.data).toBe(initial)
  rerender({ id: 'other', start: 0 }); await settle()
  const current = result.current.data
  await act(async () => { release?.() })
  expect(result.current.data).toBe(current); expect(result.current.status).toBe('ready')
})

it('100ms 放大允许 hop16，请求列数仍受视口宽度与固定块约束', () => {
  const view = { start: 48000, end: 52800 }
  const plan = planSpectrogramRequest(view, 1600, duration)
  expect(plan.hop).toBe(16)
  expect((plan.endFrame - plan.startFrame) / plan.hop).toBeLessThanOrEqual(2 * 1600 + 2048)
})

it('8192 FFT 双声道的 1023 列后端块与 1024 列前端块错开时，不缺列、不重复、不移半个 hop', async () => {
  vi.useFakeTimers()
  const hop = 16, bins = 4097, columns = spectrogramTileColumns(2, 8192)
  expect(columns).toBe(1023)
  mocks.request.mockImplementation(async (request: AudioEditSpectrogramRequest): Promise<AudioEditSpectrogramChunk> => {
    const step = request.hop!, start = Math.floor(request.startFrame / (step * columns)) * step * columns
    const end = Math.min(duration, start + step * columns), timeBins = Math.ceil((end - start) / step)
    const values = new Uint8Array(2 * timeBins * bins)
    for (let c = 0; c < 2; c++) for (let t = 0; t < timeBins; t++) values.fill(40 + c * 80 + (start / step + t) % 70, (c * timeBins + t) * bins, (c * timeBins + t + 1) * bins)
    return { startFrame: start, endFrame: end, sampleRate: 48000, channels: 2, fftSize: 8192, hop: step, frequencyBins: bins, timeBins, values }
  })
  const { result } = renderHook(() => useAudioEditSpectrogram('p', { start: 16000, end: 20800 }, 1600, duration, 'source', 0))
  await settle()
  expect(result.current.status).toBe('ready')
  const data = result.current.data!
  expect(data.hop).toBe(hop)
  expect(data.startFrame).toBe(-hop / 2)
  for (let c = 0; c < 2; c++) for (let t = 0; t < data.frameCount; t++) expect(data.values[(c * data.frameCount + t) * bins]).toBe(40 + c * 80 + Math.min(t, data.frameCount - 2) % 70)
  expect(mocks.request.mock.calls.every(([r]) => r.windowSize === 2048 && r.timePooling === true)).toBe(true)
  expect(chunkToSpectrogram([chunk({ projectId: 'p', startFrame: 512, endFrame: 1024, hop: 128 })]).startFrame).toBe(448)
})

it('半 hop 左移后仍覆盖请求末尾，尾列只补在拼接完成后的最右边', () => {
  const a = { ...chunk({ projectId: 'p', startFrame: 0, endFrame: 256, hop: 128 }), values: new Uint8Array([30, 40, 50, 60, 70, 80]) }
  const b = { ...a, startFrame: 256, endFrame: 512, values: new Uint8Array([90, 100, 110, 120, 130, 140]) }
  const result = chunkToSpectrogram([a, b])
  expect(result.startFrame + result.frameCount * result.hop).toBeGreaterThanOrEqual(512)
  expect([...result.values]).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 120, 130, 140])
  // 非整 hop 尾部本已被最后一格覆盖，不多添一列。
  expect(chunkToSpectrogram([{ ...b, endFrame: 440 }]).frameCount).toBe(2)
})
