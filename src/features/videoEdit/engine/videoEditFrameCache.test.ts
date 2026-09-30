import { expect, it, vi } from 'vitest'
import { VideoEditFrameCache, type CachedVideoEditFrame } from './videoEditFrameCache'

const frame = (timestamp: number, duration = .1): CachedVideoEditFrame => ({ timestamp, duration, bitmap: { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap })
it('按源时间戳命中变帧率帧，并隔离同时间的不同素材', () => {
  const cache = new VideoEditFrameCache(1600); const first = frame(1, .037); const second = frame(1.037, .05)
  cache.put('a', first, new Set()); cache.put('a', second, new Set())
  expect(cache.get('a', 1.036)).toBe(first); expect(cache.get('a', 1.037)).toBe(second)
  expect(cache.get('b', 1.037)).toBeUndefined(); expect(cache.get('a', 1.087)).toBeUndefined()
  cache.clear(); expect(first.bitmap.close).toHaveBeenCalledOnce(); expect(second.bitmap.close).toHaveBeenCalledOnce(); expect(cache.bytes).toBe(0)
})
it('淘汰最久未用的像素资源，保护正在合成的借用帧', () => {
  const cache = new VideoEditFrameCache(800); const a = frame(0); const b = frame(1); const c = frame(2)
  cache.put('media', a, new Set()); cache.put('media', b, new Set())
  cache.get('media', 0); cache.put('media', c, new Set([a]))
  expect(b.bitmap.close).toHaveBeenCalledOnce(); expect(a.bitmap.close).not.toHaveBeenCalled(); expect(cache.bytes).toBe(800)
  cache.deleteMedia('media'); expect(a.bitmap.close).toHaveBeenCalledOnce(); expect(c.bitmap.close).toHaveBeenCalledOnce()
})
it('重复解码帧不扩大缓存，重复结果立即释放', () => {
  const cache = new VideoEditFrameCache(800); const a = frame(0); const duplicate = frame(0)
  cache.put('a', a, new Set()); cache.put('a', duplicate, new Set())
  expect(cache.bytes).toBe(400); expect(cache.get('a', 0)).toBe(a); expect(duplicate.bitmap.close).toHaveBeenCalledOnce()
  cache.clear(); cache.clear(); expect(a.bitmap.close).toHaveBeenCalledOnce()
})
