// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditProjectThumbnail } from './VideoEditProjectThumbnail'
const cached = vi.hoisted(() => vi.fn())
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ video: { getCachedThumbnail: cached } }) }))
vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (path: string) => `media:${path}` }))
let intersect: (entries: Array<{ isIntersecting: boolean }>) => void
beforeEach(() => {
  cached.mockReset()
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof intersect) { intersect = callback } observe(): void {} disconnect(): void {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const media = { id: 'video', name: '原视频', kind: 'video' as const, path: 'D:/source.mp4', width: 3840, height: 2160, durationSeconds: 5 }
it('只在真实可见域请求缩略图，离开/隐藏/卸载取消且迟到结果不挂载图像', async () => {
  let finish!: (value: { path: string }) => void
  cached.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<VideoEditProjectThumbnail media={media} kind="video" active />)
  expect(cached).not.toHaveBeenCalled()
  act(() => intersect([{ isIntersecting: true }]))
  const signal = cached.mock.calls[0][1] as AbortSignal
  expect(cached).toHaveBeenCalledWith(media.path, signal)
  act(() => intersect([{ isIntersecting: false }]))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ path: 'D:/late.jpg' }))
  expect(view.container.querySelector('img')).toBeNull()
  act(() => intersect([{ isIntersecting: true }]))
  const second = cached.mock.calls[1][1] as AbortSignal
  view.rerender(<VideoEditProjectThumbnail media={media} kind="video" active={false} />)
  expect(second.aborted).toBe(true)
  view.rerender(<VideoEditProjectThumbnail media={media} kind="video" active />)
  act(() => intersect([{ isIntersecting: true }]))
  const third = cached.mock.calls.at(-1)![1] as AbortSignal
  view.unmount(); expect(third.aborted).toBe(true)
})
it('命中宿主缓存只展示缓存路径，失败保留可恢复提示且不启动源视频解码', async () => {
  cached.mockResolvedValue({ path: 'D:/cached.jpg' })
  const view = render(<VideoEditProjectThumbnail media={media} kind="video" active />)
  await act(async () => intersect([{ isIntersecting: true }]))
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('media:D:/cached.jpg')
  expect(view.container.querySelector('video')).toBeNull()
  cached.mockRejectedValue(new Error('missing'))
  view.rerender(<VideoEditProjectThumbnail media={{ ...media, path: 'D:/missing.mp4' }} kind="video" active />)
  await act(async () => {})
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.firstElementChild?.getAttribute('title')).toContain('重新定位')
})
