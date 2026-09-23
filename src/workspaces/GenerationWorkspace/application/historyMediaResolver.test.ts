import { beforeEach, expect, it, vi } from 'vitest'
import { exists, join } from '@/platform/desktopApi'
import { grantMediaAccessForReference } from '@/services/largeUploadPolicy'
import { getHistoryThumbnailCachePath } from '@/utils/historyThumbnail'
import { createHistoryMediaResolver } from './historyMediaResolver'

vi.mock('@/platform/desktopApi', () => ({
  exists: vi.fn(async () => true),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  toDisplaySrc: (path: string) => `media:${path}`,
}))
vi.mock('@/services/largeUploadPolicy', () => ({ grantMediaAccessForReference: vi.fn(async () => undefined) }))
vi.mock('@/utils/historyThumbnail', () => ({
  getHistoryThumbnailCachePath: vi.fn(async (path: string, dir: string) => `${dir}/${path.split('/').at(-1)}.webp`),
}))
beforeEach(() => { vi.clearAllMocks(); vi.mocked(exists).mockResolvedValue(true); vi.mocked(grantMediaAccessForReference).mockResolvedValue(undefined) })

it('万条重复引用只检查一次原文件和缩略图，保留每条结果及原顺序', async () => {
  const resolve = createHistoryMediaResolver('/data')
  const results = await Promise.all(Array.from({ length: 10000 }, () => resolve(['/image.png', '/image.png'], 'image')))
  expect(results).toHaveLength(10000)
  expect(results.every(result => result.skippedCount === 0 && result.urls.join(',') === 'media:/data/Thumbnails/image.png.webp,media:/data/Thumbnails/image.png.webp')).toBe(true)
  expect(exists).toHaveBeenCalledTimes(2)
  expect(grantMediaAccessForReference).toHaveBeenCalledTimes(1)
  expect(join).toHaveBeenCalledTimes(1)
})

it('不同文件的并发检查有上限，失败释放名额且不会卡住队列', async () => {
  const gates: Array<() => void> = []
  let active = 0, peak = 0
  vi.mocked(exists).mockImplementation(async (path) => {
    active++; peak = Math.max(peak, active)
    await new Promise<void>(resolve => gates.push(resolve))
    active--
    if (path === '/0') throw new Error('磁盘不可读')
    return true
  })
  const resolve = createHistoryMediaResolver('/data')
  const work = Promise.allSettled(Array.from({ length: 100 }, (_, i) => resolve([`/${i}`], 'audio')))
  for (let released = 0; released < 100;) {
    await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0))
    const batch = gates.splice(0)
    released += batch.length
    batch.forEach(release => release())
  }
  const results = await work
  expect(peak).toBe(8)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(99)
})

it('缓存失败回退原图、不可访问媒体被跳过，保留可用媒体顺序', async () => {
  vi.mocked(exists).mockImplementation(async path => path !== '/missing' && !path.includes('Thumbnails'))
  vi.mocked(grantMediaAccessForReference).mockImplementation(async path => { if (path === '/denied') throw new Error('拒绝访问') })
  const resolve = createHistoryMediaResolver('/data')
  expect(await resolve(['/a', '/missing', '/denied', '/b'], 'image')).toEqual({ urls: ['media:/a', 'media:/b'], skippedCount: 2 })
  expect(await resolve(['/a'], 'video')).toEqual({ urls: ['media:/a'], skippedCount: 0 })
})

it('下一次加载重新检查文件，数据目录变更不会复用旧缩略图', async () => {
  expect(await createHistoryMediaResolver('/old')(['/a'], 'image')).toEqual({ urls: ['media:/old/Thumbnails/a.webp'], skippedCount: 0 })
  expect(await createHistoryMediaResolver('/new')(['/a'], 'image')).toEqual({ urls: ['media:/new/Thumbnails/a.webp'], skippedCount: 0 })
  vi.mocked(exists).mockResolvedValue(false)
  expect(await createHistoryMediaResolver('/new')(['/a'], 'image')).toEqual({ urls: [], skippedCount: 1 })
  expect(getHistoryThumbnailCachePath).toHaveBeenCalledTimes(2)
  expect(grantMediaAccessForReference).toHaveBeenCalledTimes(2)
})
