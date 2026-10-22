/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AudioEditSpectrogramChunk, AudioEditSpectrogramRequest } from '@/core/audioEdit/regions'
import { useAudioEditSpectrogram } from './useAudioEditSpectrogram'

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
