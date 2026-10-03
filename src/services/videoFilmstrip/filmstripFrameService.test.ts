import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const platform = vi.hoisted(() => ({ video: { getFilmstripFrame: vi.fn() } }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => platform }))
vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (path: string) => `henji-media://${path}` }))
import type { FilmstripFrameRequest } from '@/platform/contracts/video'
import {
  acquireFilmstripFrames, filmstripFrameStatistics, filmstripFramesRevision, nearestFilmstripFrame, readFilmstripFrame, resetFilmstripFramesForTests, subscribeFilmstripFrames,
  type FilmstripFrameRef,
} from './filmstripFrameService'

interface Call { request: FilmstripFrameRequest; signal: AbortSignal; resolve: (value: { path: string }) => void; reject: (error: unknown) => void }
let calls: Call[]
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const ref = (timeUs: number, height: 48 | 96 = 48, source = 'D:/clip.mp4'): FilmstripFrameRef => ({ source, timeUs, height })
beforeEach(() => {
  calls = []
  platform.video.getFilmstripFrame.mockImplementation((request: FilmstripFrameRequest, signal: AbortSignal) => new Promise<{ path: string }>((resolve, reject) => { calls.push({ request, signal, resolve, reject }) }))
})
afterEach(() => { resetFilmstripFramesForTests(); vi.resetAllMocks(); vi.useRealTimers() })

describe('renderer filmstrip frame service', () => {
  it('shares one request per frame, publishes it once and cancels a frame nobody shows any more', async () => {
    const releaseA = acquireFilmstripFrames([ref(0), ref(1_000_000)])
    const releaseB = acquireFilmstripFrames([ref(0)])
    expect(calls.map(call => call.request)).toEqual([{ source: 'D:/clip.mp4', timeUs: 0, height: 48 }, { source: 'D:/clip.mp4', timeUs: 1_000_000, height: 48 }])
    releaseA()
    expect(calls[0].signal.aborted).toBe(false)
    expect(calls[1].signal.aborted).toBe(true)
    const notified = vi.fn(); const unsubscribe = subscribeFilmstripFrames(notified)
    const before = filmstripFramesRevision()
    calls[0].resolve({ path: 'D:/cache/a.webp' }); await flush(); await new Promise(resolve => setTimeout(resolve, 30))
    expect(readFilmstripFrame(ref(0))).toBe('henji-media://D:/cache/a.webp')
    expect(filmstripFramesRevision()).toBe(before + 1); expect(notified).toHaveBeenCalledTimes(1)
    // Shown again later: the cancelled frame is requested anew, the ready one is not.
    const again = acquireFilmstripFrames([ref(0), ref(1_000_000)])
    expect(calls).toHaveLength(3); expect(calls[2].request.timeUs).toBe(1_000_000)
    again(); releaseB(); unsubscribe()
  })

  it('limits requests in flight and serves first tiles before the rest', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ref((index + 1) * 1_000_000))
    const release = acquireFilmstripFrames(many)
    expect(calls).toHaveLength(24)
    const first = acquireFilmstripFrames([ref(0, 48, 'D:/other.mp4')], () => 'first')
    expect(filmstripFrameStatistics()).toMatchObject({ inFlight: 24, queued: 7 })
    calls[0].resolve({ path: 'D:/cache/1.webp' }); await flush()
    expect(calls[24].request.source).toBe('D:/other.mp4')
    release(); first()
    expect(filmstripFrameStatistics().queued).toBe(0)
  })

  it('falls back to the nearest ready frame of the same source and height while a new zoom level loads', async () => {
    const release = acquireFilmstripFrames([ref(0), ref(2_000_000)])
    calls[0].resolve({ path: 'D:/cache/0.webp' }); calls[1].resolve({ path: 'D:/cache/2.webp' }); await flush()
    expect(nearestFilmstripFrame(ref(1_500_000))).toBe('henji-media://D:/cache/0.webp')
    expect(nearestFilmstripFrame(ref(2_500_000))).toBe('henji-media://D:/cache/2.webp')
    expect(nearestFilmstripFrame(ref(1_500_000, 96))).toBeUndefined()
    expect(nearestFilmstripFrame(ref(0, 48, 'D:/other.mp4'))).toBeUndefined()
    release()
  })

  it('marks failures without retrying them and keeps other frames working', async () => {
    const release = acquireFilmstripFrames([ref(0), ref(1_000_000)])
    calls[0].reject(new Error('素材尚未获得读取权限')); calls[1].resolve({ path: 'D:/cache/1.webp' }); await flush()
    expect(readFilmstripFrame(ref(0))).toBeUndefined()
    expect(filmstripFrameStatistics()).toMatchObject({ failed: 1, ready: 1 })
    const again = acquireFilmstripFrames([ref(0)])
    expect(calls).toHaveLength(2)
    again(); release()
  })
})
