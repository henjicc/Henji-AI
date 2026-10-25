import { beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { PreviewChunkCache } from './previewChunkCache'

const { prepare, flush } = vi.hoisted(() => ({ prepare: vi.fn(), flush: vi.fn(async () => undefined) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { preparePreviewChunk: prepare } }) }))
vi.mock('../application/audioEditProjectInstances', () => ({ flushAudioEditProject: flush }))
const project: AudioEditProjectDocument = {
  id: 'cache', name: '缓存', referenceScript: '', suggestions: [], vstEnabled: false, transcript: [], createdAt: 1, updatedAt: 1, revision: 1,
  source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 48000 * 100, sampleRate: 48000, channels: 2 },
}
const span = (start: number, end: number, muted = false) => ({ sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: start, outputEndFrame: end, muted })
beforeEach(() => {
  flush.mockClear()
  prepare.mockReset().mockImplementation(async ({ sourceStartFrame, frameCount }) => ({
    sourceStartFrame, sourceEndFrame: sourceStartFrame + frameCount, channels: 2, sampleRate: 48000,
    pcm: Float32Array.from({ length: frameCount * 2 }, (_, i) => (i % 2 ? -1 : 1) * (sourceStartFrame + Math.floor(i / 2))).buffer,
  }))
})

it('按秒对齐并合并并发读取，transfer 不损坏缓存，LRU 最多保留 30 秒', async () => {
  const cache = new PreviewChunkCache(project, 'source', [span(0, project.source.durationFrames)])
  const [first, second] = await Promise.all([cache.read(123, 80), cache.read(456, 80)])
  expect(prepare.mock.calls).toEqual([[expect.objectContaining({ sourceStartFrame: 0, frameCount: 48000 })]])
  expect(new Float32Array(second!.pcm)[0]).toBe(456)
  structuredClone(first!.pcm, { transfer: [first!.pcm] })
  expect(new Float32Array((await cache.read(123, 80))!.pcm)[0]).toBe(123)
  for (let second = 1; second <= 30; second++) await cache.read(second * 48000, 1)
  expect(prepare).toHaveBeenCalledTimes(31)
  await cache.read(48000, 1)
  expect(prepare).toHaveBeenCalledTimes(31)
  await cache.read(0, 1)
  expect(prepare).toHaveBeenCalledTimes(32)
})

it('80ms 试听跨秒边界和删除拼接点，静音及双声道顺序与正常取样一致', async () => {
  const cache = new PreviewChunkCache(project, 'edited', [span(0, 48000), span(96000, 97000, true), span(144000, 192000)])
  const grain = new Float32Array((await cache.grain(47000)).pcm)
  expect(grain).toHaveLength(3840 * 2)
  expect(Array.from(grain.slice(0, 4))).toEqual([47000, -47000, 47001, -47001])
  expect(Array.from(grain.slice(2000, 4000))).toEqual(Array(2000).fill(0))
  // 静音之后淡入（5 ms，正弦曲线）：第一帧接近 0，不会从 144000 直接跳出来
  const fadeIn = (frame: number) => Math.sin((frame + 0.5) / 240 * Math.PI / 2)
  expect(grain[4000]).toBeCloseTo(144000 * fadeIn(0), 2)
  expect(grain[4001]).toBeCloseTo(-144000 * fadeIn(0), 2)
  expect(grain[4002]).toBeCloseTo(144001 * fadeIn(1), 2)
  expect(grain[4003]).toBeCloseTo(-144001 * fadeIn(1), 2)
  expect(prepare.mock.calls.map(([request]) => request.sourceStartFrame)).toEqual([0, 144000])
  expect(flush).toHaveBeenCalledTimes(1)
})

it.each(['edited', 'delivery'] as const)('%s 连续播放与擦洗在跨秒拼接点一致，缓存重读不叠加淡变', async mode => {
  prepare.mockImplementation(async ({ sourceStartFrame, frameCount }) => ({
    sourceStartFrame, sourceEndFrame: sourceStartFrame + frameCount, channels: 2, sampleRate: 48000,
    pcm: Float32Array.from({ length: frameCount * 2 }, (_, i) => {
      const value = sourceStartFrame + Math.floor(i / 2) < 49000 ? 0.75 : -0.5
      return i % 2 ? -value : value
    }).buffer,
  }))
  const spans = [span(0, 48100), span(96000, 144000)]
  const cache = new PreviewChunkCache(project, mode, spans)
  const grain = new Float32Array((await cache.grain(47800)).pcm)
  const first = await cache.read(47800, 3840)
  const second = await cache.read(48000, 3840)
  const third = await cache.read(48100, 3540)
  const playback = new Float32Array(grain.length)
  playback.set(new Float32Array(first!.pcm))
  playback.set(new Float32Array(second!.pcm), 200 * 2)
  playback.set(new Float32Array(third!.pcm), 300 * 2)
  expect(playback).toEqual(grain)
  let maxJump = 0
  for (let i = 2; i < grain.length; i++) maxJump = Math.max(maxJump, Math.abs(grain[i] - grain[i - 2]))
  expect(maxJump).toBeLessThan(0.004)
  expect(new Float32Array((await cache.read(48000, 100))!.pcm)).toEqual(new Float32Array(second!.pcm))
  const original = new PreviewChunkCache(project, 'source', [span(0, project.source.durationFrames)])
  expect(new Float32Array((await original.read(48000, 100))!.pcm)).toEqual(Float32Array.from({ length: 200 }, (_, i) => i % 2 ? -0.75 : 0.75))
})

it('静音状态切换降低跳变，连续未静音片段不产生音量凹陷', async () => {
  prepare.mockImplementation(async ({ sourceStartFrame, frameCount }) => ({
    sourceStartFrame, sourceEndFrame: sourceStartFrame + frameCount, channels: 2, sampleRate: 48000,
    pcm: new Float32Array(frameCount * 2).fill(0.75).buffer,
  }))
  const cache = new PreviewChunkCache(project, 'edited', [span(0, 1000), span(1000, 2000, true), span(2000, 2500), span(2500, 4000)])
  const samples = new Float32Array((await cache.grain(0)).pcm)
  let maxJump = 0
  for (let i = 2; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 2]))
  // 5 ms 正弦淡变的最大单步约 0.75·(π/2)/240≈0.005，硬切是 0.75
  expect(maxJump).toBeLessThan(0.006)
  expect(samples.slice(1000 * 2, 2000 * 2)).toEqual(new Float32Array(2000))
  expect(samples.slice(2240 * 2)).toEqual(new Float32Array(samples.length - 2240 * 2).fill(0.75))
})

it('交付的前后补静音和尾部短段不越界、不循环，读取失败可重试', async () => {
  const cache = new PreviewChunkCache(project, 'delivery', [span(-1000, 1000), span(project.source.durationFrames, project.source.durationFrames + 1000)])
  const grain = new Float32Array((await cache.grain(-1000)).pcm)
  expect(grain).toHaveLength(3000 * 2)
  expect(Array.from(grain.slice(0, 2000))).toEqual(Array(2000).fill(0))
  expect(Array.from(grain.slice(4000))).toEqual(Array(2000).fill(0))
  expect((await cache.grain(project.source.durationFrames + 1000)).pcm.byteLength).toBe(0)
  const retry = new PreviewChunkCache(project, 'edited', [span(0, 48000)])
  prepare.mockRejectedValueOnce(new Error('读取失败'))
  await expect(retry.read(0, 100)).rejects.toThrow('读取失败')
  expect((await retry.read(0, 100))!.sourceEndFrame).toBe(100)
})
