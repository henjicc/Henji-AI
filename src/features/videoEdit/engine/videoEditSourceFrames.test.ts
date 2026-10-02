import { beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import type { RenderResponse } from './videoEditWorker'
import { VideoEditSourceFrames, videoEditSourceBackend } from './videoEditSourceFrames'

const boundary = vi.hoisted(() => ({
  created: [] as Array<{ document: VideoEditComposition; previewWidth?: number; surface?: OffscreenCanvas; budget?: number }>,
  documents: [] as VideoEditComposition[], invalidations: [] as number[],
  update: vi.fn<[VideoEditComposition], Promise<void>>(),
  present: vi.fn<[number, boolean, boolean, number?], Promise<RenderResponse>>(),
  dispose: vi.fn<[], Promise<void>>(),
}))
vi.mock('./videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(document: VideoEditComposition, previewWidth?: number, _preparing?: (active: boolean) => void, surface?: OffscreenCanvas, budget?: number) { boundary.created.push({ document, previewWidth, surface, budget }) }
  updateDocument(document: VideoEditComposition): Promise<void> { boundary.documents.push(document); return boundary.update(document) }
  invalidateDocument(revision: number): void { boundary.invalidations.push(revision) }
  present(frame: number, sequential: boolean, scrubbing: boolean, deadline?: number): Promise<RenderResponse> { return boundary.present(frame, sequential, scrubbing, deadline) }
  dispose(): Promise<void> { return boundary.dispose() }
} }))
const decoding = vi.hoisted(() => ({ status: vi.fn(async () => ({ available: true, forcedBackend: null as 'native' | 'browser' | null })), browser: vi.fn(async (_url: string) => true) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ videoDecoder: { status: decoding.status } }) }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (path: string) => `url:${path}`, isLikelyLocalImagePath: (path: string) => /^[A-Z]:/.test(path) }))
vi.mock('./videoEditBrowserFrames', () => ({ videoEditBrowserDecodable: decoding.browser }))
const media: VideoEditMedia = { id: 'media', name: '原视频', kind: 'video', path: 'D:/素材/原视频.mp4', sourceRevision: 'relinked', assetId: 'asset', width: 3840, height: 2160, durationSeconds: 7, frameRate: { numerator: 60, denominator: 1 } }
function surface() {
  const transferred = { width: media.width, height: media.height } as OffscreenCanvas
  const transfer = vi.fn(() => transferred)
  return { canvas: { width: 0, height: 0, transferControlToOffscreen: transfer } as unknown as HTMLCanvasElement, transferred, transfer }
}
function response(timestamp = 119 / 60): RenderResponse { return { id: 1, presented: true, sourceTimestamps: [timestamp], decodeMs: 2, gpuMs: 3, cacheHits: 1, cacheBytes: 12_441_600 } }
async function flush(): Promise<void> { for (let index = 0; index < 6; index++) await Promise.resolve() }
beforeEach(() => {
  boundary.created = []; boundary.documents = []; boundary.invalidations = []
  boundary.update.mockReset().mockResolvedValue(undefined)
  boundary.present.mockReset().mockResolvedValue(response())
  boundary.dispose.mockReset().mockResolvedValue(undefined)
})

it('原路径全尺寸直连与3GiB预算，逐次更新源微秒并保持同一片段和媒体身份', async () => {
  const input = { ...media }; const target = surface(); const frames = new VideoEditSourceFrames(input, target.canvas)
  const initial = boundary.created[0]
  expect(initial).toMatchObject({ previewWidth: 3840, surface: target.transferred, budget: 3 * 1024 ** 3 })
  expect(target.canvas).toMatchObject({ width: 3840, height: 2160 }); expect(target.transfer).toHaveBeenCalledOnce()
  expect(initial.document.media).toEqual([media]); expect(initial.document.clips).toHaveLength(1)
  expect(initial.document.clips[0]).toMatchObject({ kind: 'video', start: 0, duration: 1, volume: 0, sourceRemainder: { numerator: 0, denominator: 1 } })
  input.path = 'D:/其他.mp4'
  expect(await frames.present(2_000_007, 1234)).toEqual({ timeUs: 2_000_007, presentedTimeUs: 1_983_333, decodeMs: 2, gpuMs: 3, cacheHits: 1, cacheBytes: 12_441_600 })
  boundary.present.mockResolvedValue(response(117 / 60)); await frames.present(1_966_007)
  expect(boundary.present).toHaveBeenNthCalledWith(1, 0, false, false, 1234)
  expect(boundary.present).toHaveBeenNthCalledWith(2, 0, false, false, undefined)
  expect(boundary.invalidations).toEqual([1, 2])
  expect(boundary.documents.map(document => document.clips[0].sourceInUs)).toEqual([2_000_007, 1_966_007])
  for (const document of boundary.documents) {
    expect(document.id).toBe(initial.document.id); expect(document.items).toBe(initial.document.items); expect(document.media).toBe(initial.document.media)
    expect(document.tracks).toBe(initial.document.tracks); expect(document.clips[0].id).toBe(initial.document.clips[0].id)
  }
  expect(initial.document.clips[0].sourceInUs).toBe(0)
  await frames.dispose()
})

it('NTSC任意微秒不按整数帧量化，实际时间只取真实渲染回执', async () => {
  const frames = new VideoEditSourceFrames({ ...media, frameRate: { numerator: 60000, denominator: 1001 } }, surface().canvas)
  const timestamp = 119 * 1001 / 60000
  boundary.present.mockResolvedValue({ id: 1, presented: true, sourceTimestamps: [timestamp] })
  expect(await frames.present(2_010_007)).toEqual({ timeUs: 2_010_007, presentedTimeUs: Math.round(timestamp * 1e6), decodeMs: 0, gpuMs: 0, cacheHits: 0, cacheBytes: 0 })
  expect(boundary.documents[0]).toMatchObject({ fps: 60000 / 1001, clips: [{ sourceInUs: 2_010_007, sourceRemainder: { numerator: 0, denominator: 1 } }] })
  await frames.dispose()
})

it('精确时长端点查询最后一帧内部一微秒并保留请求时钟', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  boundary.present.mockResolvedValue(response(419 / 60))
  expect(await frames.present(7_000_000)).toMatchObject({ timeUs: 7_000_000, presentedTimeUs: 6_983_333 })
  expect(boundary.documents[0].clips[0].sourceInUs).toBe(6_999_999)
  await frames.dispose()
})

it('非法微秒和呈现时刻在修改会话前拒绝', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  for (const timeUs of [-1, .1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 7_000_001]) await expect(frames.present(timeUs)).rejects.toThrow('整数微秒')
  for (const deadline of [-1, NaN, Infinity]) await expect(frames.present(1_000_000, deadline)).rejects.toThrow('呈现时刻')
  expect(boundary.update).not.toHaveBeenCalled(); expect(boundary.present).not.toHaveBeenCalled(); expect(boundary.invalidations).toEqual([])
  await frames.dispose()
})

it('不完整或超界的实际回执拒绝，意外位图无论成功失败均释放', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  const invalid: RenderResponse[] = [
    { id: 1, presented: false, sourceTimestamps: [1] }, { id: 1, sourceTimestamps: [1] }, { id: 1, presented: true },
    ...[NaN, Infinity, -1, 7, 7.1, 2.1].map(timestamp => response(timestamp)),
  ]
  const close = vi.fn()
  for (const result of invalid) {
    boundary.present.mockResolvedValue({ ...result, bitmap: { close } as unknown as ImageBitmap })
    await expect(frames.present(2_000_000)).rejects.toThrow('实际呈现位置')
  }
  boundary.present.mockResolvedValue({ ...response(), bitmap: { close } as unknown as ImageBitmap }); await frames.present(2_000_000)
  expect(close).toHaveBeenCalledTimes(invalid.length + 1)
  await frames.dispose()
})

it('渲染或更新失败原样传递，不伪造成功回执', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  boundary.update.mockRejectedValueOnce(new Error('媒体已失效'))
  await expect(frames.present(2_000_000)).rejects.toThrow('媒体已失效'); expect(boundary.present).not.toHaveBeenCalled()
  boundary.present.mockRejectedValueOnce(new Error('GPU已中断'))
  await expect(frames.present(2_000_000)).rejects.toThrow('GPU已中断')
  await frames.dispose(); expect(boundary.dispose).toHaveBeenCalledOnce()
})

it('更新期间取消立即失效，旧更新返回后不能再提交画面', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  let release!: () => void; boundary.update.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = frames.present(2_000_000); const rejected = expect(pending).rejects.toThrow('已被更新')
  frames.invalidate(); expect(boundary.invalidations).toEqual([1, 2])
  release(); await rejected; expect(boundary.present).not.toHaveBeenCalled()
  boundary.present.mockResolvedValue(response(.5)); await frames.present(1_000_000); expect(boundary.documents.at(-1)?.revision).toBe(3)
  await frames.dispose()
})

it('新请求不能被迟到的旧GPU回执覆盖，旧回执位图及时关闭', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  let finish!: (result: RenderResponse) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const previous = frames.present(2_000_000); const rejected = expect(previous).rejects.toThrow('已被更新'); await flush()
  boundary.present.mockResolvedValue(response(.5))
  expect(await frames.present(500_000)).toMatchObject({ timeUs: 500_000, presentedTimeUs: 500_000 })
  const close = vi.fn(); finish({ ...response(), bitmap: { close } as unknown as ImageBitmap }); await rejected
  expect(close).toHaveBeenCalledOnce(); expect(boundary.documents.at(-1)?.clips[0].sourceInUs).toBe(500_000)
  await frames.dispose()
})

it('关闭共享一次真实释放屏障，迟到GPU结果不能回填已关闭会话', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  let finish!: (result: RenderResponse) => void; let release!: () => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  boundary.dispose.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const rendering = frames.present(2_000_000); const rejected = expect(rendering).rejects.toThrow('已关闭'); await flush()
  const disposed = frames.dispose(); expect(frames.dispose()).toBe(disposed); expect(boundary.dispose).toHaveBeenCalledOnce()
  expect(boundary.invalidations).toEqual([1, 2]); await expect(frames.present(0)).rejects.toThrow('已关闭')
  const close = vi.fn(); finish({ ...response(), bitmap: { close } as unknown as ImageBitmap }); await rejected; expect(close).toHaveBeenCalledOnce()
  release(); await disposed; frames.invalidate(); expect(boundary.invalidations).toEqual([1, 2])
})

it('无效素材在转移画布和创建Worker前拒绝', () => {
  for (const invalid of [{ ...media, kind: 'image' as const }, { ...media, width: 0 }, { ...media, height: NaN }, { ...media, durationSeconds: 0 }, { ...media, durationSeconds: Infinity }, { ...media, frameRate: { numerator: 0, denominator: 1 } }]) {
    const target = surface(); expect(() => new VideoEditSourceFrames(invalid, target.canvas)).toThrow()
    expect(target.transfer).not.toHaveBeenCalled()
  }
  expect(boundary.created).toEqual([])
})

it('素材在该时间没有画面（流首帧之前）时按标称帧格确认位置，反向与播放据此逐帧前进', async () => {
  const frames = new VideoEditSourceFrames({ ...media, frameRate: { numerator: 30000, denominator: 1001 } }, surface().canvas)
  boundary.present.mockResolvedValue({ id: 1, presented: true, sourceTimestamps: [], blankPictures: 1 })
  expect(await frames.present(500_000)).toMatchObject({ timeUs: 500_000, presentedTimeUs: Math.round(14 * 1001 / 30000 * 1e6) })
  expect(await frames.playFrame(3)).toMatchObject({ presentedTimeUs: Math.round(3 * 1001 / 30000 * 1e6) })
  boundary.present.mockResolvedValue({ id: 1, presented: true, sourceTimestamps: [] })
  await expect(frames.present(500_000)).rejects.toThrow('实际呈现位置')
  await frames.dispose()
})

it('正向播放走渲染器的连续计划：切换为覆盖整个素材的片段只做一次，逐帧按节拍提交；定位回到单帧文档', async () => {
  const frames = new VideoEditSourceFrames(media, surface().canvas)
  expect(frames.frameCount).toBe(420)
  boundary.present.mockResolvedValueOnce(response(61 / 60)).mockResolvedValueOnce(response(62 / 60))
  expect(await frames.playFrame(61, 1000)).toMatchObject({ timeUs: 1_016_667, presentedTimeUs: 1_016_667 })
  expect(await frames.playFrame(62, 1016)).toMatchObject({ timeUs: 1_033_333, presentedTimeUs: 1_033_333 })
  expect(boundary.documents).toHaveLength(1)
  expect(boundary.documents[0].clips[0]).toMatchObject({ start: 0, duration: 420, sourceInUs: 0 })
  expect(boundary.present.mock.calls).toEqual([[61, true, false, 1000], [62, true, false, 1016]])
  boundary.present.mockResolvedValue(response(1))
  await frames.present(1_000_000)
  expect(boundary.documents.at(-1)?.clips[0]).toMatchObject({ duration: 1, sourceInUs: 1_000_000 })
  boundary.present.mockResolvedValue(response(63 / 60)); await frames.playFrame(63)
  expect(boundary.documents).toHaveLength(3); expect(boundary.documents.at(-1)?.clips[0]).toMatchObject({ duration: 420, sourceInUs: 0 })
  await expect(frames.playFrame(420)).rejects.toThrow('超出素材范围')
  frames.invalidate()
  let finish!: (result: RenderResponse) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const stale = frames.playFrame(64); await flush(); frames.invalidate(); finish(response(64 / 60))
  await expect(stale).rejects.toThrow('已被更新')
  await frames.dispose()
})

it('源监视器与渲染 Worker 同一规则决定后端：浏览器能完整解的留在浏览器，只有原生能解的走原生；按文件与版本缓存，失败下次重试', async () => {
  decoding.browser.mockImplementation(async url => !url.includes('prores'))
  expect(await videoEditSourceBackend({ ...media, path: 'D:/h264.mp4' })).toBe('browser')
  expect(await videoEditSourceBackend({ ...media, path: 'D:/prores.mov' })).toBe('native')
  expect(await videoEditSourceBackend({ ...media, path: 'D:/prores.mov' })).toBe('native')
  expect(decoding.browser.mock.calls.map(([url]) => url)).toEqual(['url:D:/h264.mp4', 'url:D:/prores.mov'])
  decoding.status.mockResolvedValueOnce({ available: true, forcedBackend: 'native' })
  expect(await videoEditSourceBackend({ ...media, path: 'D:/forced.mp4' })).toBe('native')
  decoding.status.mockRejectedValueOnce(new Error('no platform'))
  expect(await videoEditSourceBackend({ ...media, path: 'D:/offline.mov' })).toBe('browser')
  expect(await videoEditSourceBackend({ ...media, path: 'https://example.com/a.mp4' })).toBe('browser')
  expect(decoding.browser).toHaveBeenCalledTimes(2)
})
