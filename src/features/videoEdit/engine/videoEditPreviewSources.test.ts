// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, type VideoEditDocument } from '@/core/videoEdit/document'
import { VideoEditPreviewSources } from './videoEditPreviewSources'
const native = vi.hoisted(() => ({ prepare: vi.fn(), cancel: vi.fn(), allow: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ video: { preparePreview: native.prepare, cancelPreview: native.cancel }, media: { allowRoot: native.allow }, system: { paths: { dirname: async () => 'D:/cache' } } }) }))
vi.mock('@/services/imageSource', () => ({ toFetchableMediaUrl: (path: string) => `media:${path}` }))
function project(): VideoEditDocument {
  const document = createVideoEditDocument('test'); document.fps = 60
  document.media = [{ id: 'source', name: 'original', path: 'E:/original.mp4', kind: 'video', durationSeconds: 120, width: 3840, height: 2160 }]
  const clip = { id: 'a', mediaId: 'source', name: 'video', kind: 'video' as const, track: 1, start: 0, duration: 60, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  document.clips = [clip, { ...clip, id: 'b', track: 2, sourceInUs: 60000000 }]
  return document
}
beforeEach(() => {
  native.prepare.mockReset().mockImplementation(async request => ({ path: `D:/cache/${request.startSeconds}.mp4`, startSeconds: request.startSeconds, durationSeconds: request.durationSeconds, preparationMs: 10, sizeBytes: 200, cacheHit: false }))
  native.cancel.mockReset().mockResolvedValue(undefined); native.allow.mockReset().mockResolvedValue(undefined)
})
it('同素材的不同时段绑定各自片段，保留源时间和原路径，重计算不重复准备', async () => {
  const document = project(); const original = structuredClone(document); const preparing = vi.fn(); const cache = new VideoEditPreviewSources(preparing)
  const first = await cache.resolve(document, 0)
  expect(first).toMatchObject([{ clipId: 'a', mediaId: 'source', startSeconds: 0, endSeconds: 32 }, { clipId: 'b', mediaId: 'source', startSeconds: 59, endSeconds: 91 }])
  preparing.mockClear(); await cache.resolve(document, 1)
  expect(native.prepare).toHaveBeenCalledTimes(4); expect(preparing).not.toHaveBeenCalled(); expect(document).toEqual(original)
  expect(native.prepare.mock.calls.map(([request]) => request.startSeconds)).toEqual([0, 29, 59, 89])
  await cache.dispose(); expect(native.cancel).toHaveBeenCalledTimes(4)
})
it('连续正反拖跨段前预取相邻段，实际源入点与映射保持一致', async () => {
  const document = project(); document.clips = [{ ...document.clips[0], duration: 60 * 90 }]
  const state = vi.fn(); const cache = new VideoEditPreviewSources(state)
  await cache.resolve(document, 26 * 60)
  await new Promise(resolve => setTimeout(resolve, 0)); state.mockClear()
  expect((await cache.resolve(document, 30 * 60))[0]).toMatchObject({ startSeconds: 29, endSeconds: 61 })
  expect(state).not.toHaveBeenCalled()
  expect(native.prepare.mock.calls.map(([request]) => request.startSeconds)).toEqual([0, 29, 59])
  await cache.dispose()
})
it('下一段准备未完成时使用重叠的已就绪段，保持实时取帧而不等待转码', async () => {
  const document = project(); document.clips = [{ ...document.clips[0], duration: 60 * 90 }]
  let release!: (value: { path: string; startSeconds: number; durationSeconds: number; preparationMs: number; sizeBytes: number; cacheHit: boolean }) => void
  native.prepare.mockImplementationOnce(async () => ({ path: 'D:/cache/0.mp4', startSeconds: 0, durationSeconds: 32, preparationMs: 10, sizeBytes: 200, cacheHit: false }))
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const state = vi.fn(); const cache = new VideoEditPreviewSources(state)
  await cache.resolve(document, 26 * 60); state.mockClear()
  expect((await cache.resolve(document, 30 * 60))[0]).toMatchObject({ startSeconds: 0, endSeconds: 32 })
  expect(state).not.toHaveBeenCalled()
  release({ path: 'D:/cache/29.mp4', startSeconds: 29, durationSeconds: 32, preparationMs: 10, sizeBytes: 200, cacheHit: false })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect((await cache.resolve(document, 31 * 60))[0]).toMatchObject({ startSeconds: 29, endSeconds: 61 })
  await cache.dispose()
})
it('关闭视口取消原请求，迟到的准备结果不能放行媒体或进入新视口', async () => {
  let release!: (value: { path: string; startSeconds: number; durationSeconds: number; preparationMs: number; sizeBytes: number; cacheHit: boolean }) => void
  native.prepare.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const cache = new VideoEditPreviewSources(); const pending = cache.resolve(project(), 0); const rejected = expect(pending).rejects.toThrow('取消')
  await cache.dispose(); release({ path: 'D:/cache/late.mp4', startSeconds: 0, durationSeconds: 32, preparationMs: 10, sizeBytes: 200, cacheHit: false })
  await rejected; expect(native.allow).not.toHaveBeenCalled(); expect(native.cancel).toHaveBeenCalledOnce()
})
it('小素材继续从原文件读取，无代理任务和界面准备状态', async () => {
  const document = project(); document.media[0].width = 1920; document.media[0].height = 1080
  const state = vi.fn(); const cache = new VideoEditPreviewSources(state)
  expect(await cache.resolve(document, 0)).toEqual([]); expect(native.prepare).not.toHaveBeenCalled(); expect(state).not.toHaveBeenCalled()
  await cache.dispose()
})
