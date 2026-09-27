// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exists, writeFile } from '@/platform/desktopApi'
import { getThumbnailsPath } from '@/utils/dataPath'
import { getOrCreateHistoryThumbnail, prepareHistoryThumbnails } from './historyThumbnail'

vi.mock('@/platform/desktopApi', () => ({
  basename: (path: string) => path.split('/').at(-1),
  join: async (...parts: string[]) => parts.join('/'),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf('/')),
  exists: vi.fn(async () => false), mkdir: vi.fn(async () => undefined),
  toDisplaySrc: (path: string) => `media:${path}`,
  writeFile: vi.fn(async () => undefined),
}))
vi.mock('@/utils/dataPath', () => ({ getThumbnailsPath: vi.fn(async () => '/data/Thumbnails') }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))

const images: FakeImage[] = []
class FakeImage {
  src = ''
  crossOrigin = ''
  naturalWidth = 1080
  naturalHeight = 540
  onload: (() => Promise<void>) | null = null
  onerror: (() => void) | null = null
  constructor() { images.push(this) }
}
beforeEach(() => {
  images.length = 0
  vi.clearAllMocks()
  vi.mocked(exists).mockResolvedValue(false)
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    expect(this.width).toBe(540)
    expect(this.height).toBe(270)
    callback({ arrayBuffer: async () => new ArrayBuffer(4) } as Blob)
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('并发重复请求只解码和写入一次，完成后重新检查磁盘而非永久缓存', async () => {
  const work = Promise.all(Array.from({ length: 1000 }, () => getOrCreateHistoryThumbnail('/a.png')))
  await vi.waitFor(() => expect(images).toHaveLength(1))
  await images[0].onload?.()
  expect((await work).every(path => path === '/data/Thumbnails/540/a.webp')).toBe(true)
  expect(writeFile).toHaveBeenCalledTimes(1)
  expect(images[0].src).toBe('')
  vi.mocked(exists).mockResolvedValue(true)
  expect(await getOrCreateHistoryThumbnail('/a.png')).toBe('/data/Thumbnails/540/a.webp')
  expect(images).toHaveLength(1)
  expect(getThumbnailsPath).toHaveBeenCalledTimes(2)
})

it('批量唯一图片最多同时解码两张，单图失败不阻塞余下图片，目录只读取一次', async () => {
  const work = prepareHistoryThumbnails(['/a.png', '/b.png', '/a.png', '/c.png', '/d.png'], () => false)
  await vi.waitFor(() => expect(images).toHaveLength(2))
  images[0].onerror?.()
  await vi.waitFor(() => expect(images).toHaveLength(3))
  await images[1].onload?.()
  await vi.waitFor(() => expect(images).toHaveLength(4))
  await Promise.all([images[2].onload?.(), images[3].onload?.()])
  await work
  expect(writeFile).toHaveBeenCalledTimes(3)
  expect(getThumbnailsPath).toHaveBeenCalledTimes(1)
})

it('批次取消后完成在途两项，不再解码剩余媒体', async () => {
  let cancelled = false
  const work = prepareHistoryThumbnails(Array.from({ length: 10000 }, (_, i) => `/${i}.png`), () => cancelled)
  await vi.waitFor(() => expect(images).toHaveLength(2))
  cancelled = true
  await Promise.all(images.map(image => image.onload?.()))
  await work
  expect(images).toHaveLength(2)
  expect(writeFile).toHaveBeenCalledTimes(2)
})

it('加载超时断开回调并释放并发名额，迟到的加载不能再写文件', async () => {
  vi.useFakeTimers()
  const works = ['/a.png', '/b.png', '/c.png'].map(path => getOrCreateHistoryThumbnail(path, undefined, '/data/Thumbnails'))
  await vi.advanceTimersByTimeAsync(1)
  expect(images).toHaveLength(2)
  const lateLoad = images[0].onload
  await vi.advanceTimersByTimeAsync(15000)
  expect(images[0].onload).toBeNull()
  expect(images[0].src).toBe('')
  await vi.waitFor(() => expect(images).toHaveLength(3))
  await lateLoad?.()
  await images[2].onload?.()
  expect(await Promise.all(works)).toEqual([undefined, undefined, '/data/Thumbnails/540/c.webp'])
  expect(writeFile).toHaveBeenCalledTimes(1)
})
