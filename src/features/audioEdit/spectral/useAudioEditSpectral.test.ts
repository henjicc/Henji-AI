/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPECTRAL_HIGH_BINS, SPECTRAL_TILE_COLUMNS, spectralLowBins, type AudioEditSpectralTile, type AudioEditSpectralTileRequest } from '@/core/audioEdit/spectralPyramid'
import { SpectralTileStore } from '@/core/audio/spectralTiles'
import { StrictMode, createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { SpectralTileScheduler, spectralNeeds, spectralOverviewLevel, useAudioEditSpectral, type SpectralTileClient } from './useAudioEditSpectral'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }))

const SR = 48000, DURATION = SR * 600
function tileFor(request: AudioEditSpectralTileRequest, overrides: Partial<AudioEditSpectralTile> = {}): AudioEditSpectralTile {
  return { mode: request.mode, revision: 0, level: request.level, tile: request.tile, sampleRate: SR, channels: 1, durationFrames: DURATION, lowBins: spectralLowBins(SR), highBins: SPECTRAL_HIGH_BINS,
    columnStart: request.tile * SPECTRAL_TILE_COLUMNS, columnCount: 4, complete: true, values: new Uint8Array(4 * (spectralLowBins(SR) + SPECTRAL_HIGH_BINS) * 2), ...overrides }
}
function fakeClient() {
  const pending: Array<{ request: AudioEditSpectralTileRequest; resolve: (tile: AudioEditSpectralTile) => void; reject: (error: Error) => void }> = []
  const cancelled: string[] = []
  const client: SpectralTileClient = {
    fetch: request => new Promise((resolve, reject) => pending.push({ request, resolve, reject })),
    cancel: id => { cancelled.push(id) },
    subscribe: () => () => {},
  }
  return { client, pending, cancelled }
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('频谱取块顺序', () => {
  it('先可见块（由中间向两边），再总览，最后预取', () => {
    const needs = spectralNeeds({ start: SR * 100, end: SR * 110 }, 1000, DURATION)
    const overview = spectralOverviewLevel(DURATION)
    const first = needs.findIndex(need => need.level === overview)
    expect(needs[0].level).toBe(needs[first - 1].level)
    expect(first).toBeGreaterThan(0)
    expect(needs.slice(first + 1).every(need => need.level !== overview)).toBe(true)
    expect(new Set(needs.map(need => `${need.level}|${need.tile}`)).size).toBe(needs.length)
  })
})

describe('频谱取块调度', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const target = { projectId: 'p', mode: 'source' as const, revision: 0 }

  it('计算层限并发，不再需要的请求过一会儿才取消，宽限期内又需要就保留', async () => {
    const { client, pending, cancelled } = fakeClient()
    const scheduler = new SpectralTileScheduler(client, new SpectralTileStore(), target, () => {}, () => {})
    scheduler.setNeeds([0, 1, 2, 3, 4].map(tile => ({ level: 0, tile })))
    expect(pending).toHaveLength(3)
    scheduler.setNeeds([{ level: 0, tile: 1 }])
    scheduler.setNeeds([0, 1].map(tile => ({ level: 0, tile })))
    vi.advanceTimersByTime(400)
    expect(cancelled).toEqual([pending[2].request.requestId])
    scheduler.dispose()
  })

  it('落盘层的部分块在进度越过它的末端后重取', async () => {
    const { client, pending } = fakeClient()
    const store = new SpectralTileStore()
    let changes = 0
    const scheduler = new SpectralTileScheduler(client, store, target, () => { changes++ }, () => {})
    scheduler.setNeeds([{ level: 5, tile: 0 }])
    pending[0].resolve(tileFor(pending[0].request, { complete: false, columnCount: 2 }))
    await flush()
    expect(changes).toBe(1)
    expect(pending).toHaveLength(1)
    scheduler.progress({ projectId: 'p', mode: 'source', revision: 0, coveredFrames: 10, durationFrames: DURATION, done: false })
    expect(pending).toHaveLength(1)
    scheduler.progress({ projectId: 'p', mode: 'source', revision: 0, coveredFrames: SR * 60, durationFrames: DURATION, done: false })
    expect(pending).toHaveLength(2)
    scheduler.dispose()
  })

  it('部分块晚于“已完成”通知到达时立刻重取，不会永远停在半截', async () => {
    const { client, pending } = fakeClient()
    const scheduler = new SpectralTileScheduler(client, new SpectralTileStore(), target, () => {}, () => {})
    scheduler.setNeeds([{ level: 5, tile: 0 }])
    scheduler.progress({ projectId: 'p', mode: 'source', revision: 0, coveredFrames: DURATION, durationFrames: DURATION, done: true })
    pending[0].resolve(tileFor(pending[0].request, { complete: false, columnCount: 2 }))
    await flush()
    expect(pending).toHaveLength(2)
    scheduler.dispose()
  })

  it('过期版本的结果丢弃，连续失败才报错', async () => {
    const { client, pending } = fakeClient()
    const store = new SpectralTileStore()
    const errors: string[] = []
    const scheduler = new SpectralTileScheduler(client, store, { projectId: 'p', mode: 'edited', revision: 2 }, () => {}, message => errors.push(message))
    scheduler.setNeeds([{ level: 0, tile: 0 }])
    pending[0].resolve(tileFor(pending[0].request, { revision: 1 }))
    await flush()
    expect(store.version).toBe(0)
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.advanceTimersByTime(5000)
      pending.at(-1)!.reject(new Error('读不到'))
      await flush()
    }
    expect(errors).toEqual(['读不到'])
    scheduler.dispose()
  })
})

describe('频谱取块钩子', () => {
  it('开发模式重复挂载后仍然发出请求，不会一直停在加载中', () => {
    const { client, pending, cancelled } = fakeClient()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)
    renderHook(() => useAudioEditSpectral(client, 'p', { start: 0, end: SR * 10 }, 1000, DURATION, 'source', 0), { wrapper })
    // 第一次挂载的请求会在卸载时取消；第二次挂载必须重新发出仍然有效的请求。
    expect(pending.filter(item => !cancelled.includes(item.request.requestId)).length).toBeGreaterThan(0)
  })

  it('原始模式下作品版本变化不重新请求；剪后模式换版本才换一套块', () => {
    const { client, pending } = fakeClient()
    const view = { start: 0, end: SR * 10 }
    const { rerender } = renderHook(({ revision, mode }: { revision: number; mode: 'source' | 'edited' }) => useAudioEditSpectral(client, 'p', view, 1000, DURATION, mode, revision), { initialProps: { revision: 1, mode: 'source' } })
    const first = pending.length
    expect(first).toBeGreaterThan(0)
    rerender({ revision: 2, mode: 'source' })
    rerender({ revision: 3, mode: 'source' })
    expect(pending).toHaveLength(first)
    expect(new Set(pending.map(item => item.request.requestId)).size).toBe(pending.length)
    rerender({ revision: 3, mode: 'edited' })
    expect(pending.length).toBeGreaterThan(first)
  })
})
