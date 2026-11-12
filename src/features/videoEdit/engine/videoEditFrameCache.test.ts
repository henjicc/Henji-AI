import { expect, it, vi } from 'vitest'
import { VideoEditFrameCache, type CachedVideoEditFrame } from './videoEditFrameCache'

const frame = (timestamp: number, duration = .1): CachedVideoEditFrame => ({ timestamp, duration, allocationSize: () => 400, close: vi.fn() })
it('按源时间戳命中变帧率帧，并隔离同时间的不同素材', () => {
  const cache = new VideoEditFrameCache(1600); const first = frame(1, .037); const second = frame(1.037, .05)
  cache.put('a', first, new Set()); cache.put('a', second, new Set())
  expect(cache.get('a', 1.036)).toBe(first); expect(cache.get('a', 1.037)).toBe(second)
  expect(cache.get('b', 1.037)).toBeUndefined(); expect(cache.get('a', 1.087)).toBeUndefined()
  cache.clear(); expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce(); expect(cache.bytes).toBe(0)
})
it('淘汰最久未用的像素资源，保护正在合成的借用帧', () => {
  const cache = new VideoEditFrameCache(800); const a = frame(0); const b = frame(1); const c = frame(2)
  cache.put('media', a, new Set()); cache.put('media', b, new Set())
  cache.get('media', 0); cache.put('media', c, new Set([a]))
  expect(b.close).toHaveBeenCalledOnce(); expect(a.close).not.toHaveBeenCalled(); expect(cache.bytes).toBe(800)
  cache.deleteMedia('media'); expect(a.close).toHaveBeenCalledOnce(); expect(c.close).toHaveBeenCalledOnce()
})
it('重复解码帧不扩大缓存，重复结果立即释放', () => {
  const cache = new VideoEditFrameCache(800); const a = frame(0); const duplicate = frame(0)
  cache.put('a', a, new Set()); cache.put('a', duplicate, new Set())
  expect(cache.bytes).toBe(400); expect(cache.get('a', 0)).toBe(a); expect(duplicate.close).toHaveBeenCalledOnce()
  cache.clear(); cache.clear(); expect(a.close).toHaveBeenCalledOnce()
})
it('按画面移动方向淘汰：先淘汰未显示素材，再淘汰已经越过的帧，保留前方（预取）的帧；反向移动时对称', () => {
  const cache = new VideoEditFrameCache(5 * 400)
  const frames = new Map<number, CachedVideoEditFrame>()
  const put = (time: number, mediaId = 'a'): void => { const value = frame(time); frames.set(time, value); cache.put(mediaId, value, new Set()) }
  cache.setHotFrames([{ mediaId: 'a', time: 0.9 }]); cache.setHotFrames([{ mediaId: 'a', time: 1 }])
  put(9, 'other'); put(0.2); put(0.5); put(1.2); put(2.5)
  put(1.6)
  expect(frames.get(9)!.close).toHaveBeenCalledOnce()
  // Forward: 0.2 is 0.7s behind (weighted 2.8) and goes before 2.5, 1.4s ahead.
  put(1.9)
  expect(frames.get(0.2)!.close).toHaveBeenCalledOnce(); expect(frames.get(2.5)!.close).not.toHaveBeenCalled()
  // Paused at the same time keeps the forward direction; a two-layer scrub (base and +1s overlay) protects both.
  cache.setHotFrames([{ mediaId: 'a', time: 1 }, { mediaId: 'a', time: 2 }])
  put(3.1)
  expect(frames.get(0.5)!.close).toHaveBeenCalledOnce()
  // Reverse: frames ahead of the motion (later times) now go first.
  cache.setHotFrames([{ mediaId: 'a', time: 0.95 }, { mediaId: 'a', time: 1.95 }])
  put(0.6)
  expect(frames.get(3.1)!.close).toHaveBeenCalledOnce(); expect(frames.get(0.6)!.close).not.toHaveBeenCalled()
  // A jump forgets the direction (symmetric distance); media no longer showing loses its protection.
  cache.setHotFrames([{ mediaId: 'b', time: 10 }])
  put(10, 'b')
  expect(cache.bytes).toBe(5 * 400); expect(cache.get('b', 10)).toBe(frames.get(10))
})
it('超过总预算的单帧不进入工作集，立即释放', () => {
  const cache = new VideoEditFrameCache(100); const large = frame(0)
  cache.put('a', large, new Set())
  expect(cache.bytes).toBe(0); expect(large.close).toHaveBeenCalledOnce()
})
it('按素材分桶、桶内按时间二分查找：乱序放入的上千帧逐帧命中，帧间空隙不命中，淘汰与删除后索引同步', () => {
  const cache = new VideoEditFrameCache(4000 * 400)
  const times = Array.from({ length: 2000 }, (_, index) => index / 25).sort((a, b) => Math.sin(a * 97) - Math.sin(b * 97))
  const frames = new Map(times.map(time => [time, frame(time, .03)]))
  for (const [time, value] of frames) { cache.put('a', value, new Set()); cache.put('b', frame(time + 1000, .03), new Set()) }
  for (const [time, value] of frames) { expect(cache.get('a', time)).toBe(value); expect(cache.get('a', time + .029)).toBe(value) }
  expect(cache.get('a', 1 / 25 + .035)).toBeUndefined(); expect(cache.get('a', -1)).toBeUndefined()
  cache.deleteMedia('b'); expect(cache.bytes).toBe(2000 * 400); expect(cache.get('b', 1000)).toBeUndefined()
  const small = new VideoEditFrameCache(2 * 400); const a = frame(0); const b = frame(1); const c = frame(2)
  small.put('m', a, new Set()); small.put('m', b, new Set()); small.get('m', 0); small.put('m', c, new Set())
  expect(b.close).toHaveBeenCalledOnce(); expect(small.get('m', 1)).toBeUndefined(); expect(small.get('m', 0)).toBe(a); expect(small.get('m', 2)).toBe(c)
})
it('时间段重叠时（定格、可变帧率时长不准）较早一帧盖住的时刻仍命中，与线性查找等价', () => {
  const cache = new VideoEditFrameCache(4000); const held = frame(1, 2); const next = frame(1.5, .1); const later = frame(3.5, .1)
  cache.put('a', held, new Set()); cache.put('a', next, new Set()); cache.put('a', later, new Set())
  expect(cache.get('a', 1.55)).toBe(next); expect(cache.get('a', 1.7)).toBe(held); expect(cache.get('a', 2.9)).toBe(held)
  expect(cache.get('a', 3.2)).toBeUndefined(); expect(cache.get('a', 3.55)).toBe(later)
})
