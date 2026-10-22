import { expect, it } from 'vitest'
import { joinSpectrogramChunks, planSpectrogramTiles, spectrogramOverviewHop, spectrogramTileColumns, SpectrogramTileLru } from './spectrogramTiles'
import type { AudioEditSpectrogramChunk } from './regions'

const chunk = (startFrame = 0): AudioEditSpectrogramChunk => ({ sampleRate: 48000, fftSize: 4, hop: 128, channels: 2, startFrame, endFrame: startFrame + 256, timeBins: 2, frequencyBins: 3, values: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) })
it('固定块覆盖边界和最后不足一块的尾部，平移不改变块身份', () => {
  const span = 1024 * 128
  expect(planSpectrogramTiles(span - 1, span + 1, span + 20, 128)).toEqual([{ index: 0, startFrame: 0, endFrame: span }, { index: 1, startFrame: span, endFrame: span + 20 }])
  expect(planSpectrogramTiles(1, span, span * 3, 128)).toEqual(planSpectrogramTiles(100, span - 1, span * 3, 128))
  expect(spectrogramTileColumns(32, 8192) * 32 * 4097).toBeLessThanOrEqual(8 * 1024 * 1024)
  expect(planSpectrogramTiles(0, 48000 * 3600, 48000 * 3600, spectrogramOverviewHop(48000 * 3600))).toHaveLength(1)
})
it('连续块按声道拼接，单块零拷贝，拒绝缺口', () => {
  const first = chunk(), second = chunk(256)
  expect(joinSpectrogramChunks([first])).toBe(first)
  expect([...joinSpectrogramChunks([first, second]).values]).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 7, 8, 9, 10, 11, 12])
  expect(() => joinSpectrogramChunks([first, chunk(512)])).toThrow('不连续')
})
it('LRU 按字节淘汰，访问续期、替换及超额对象不破坏限额', () => {
  const lru = new SpectrogramTileLru(24), data = chunk()
  lru.set('a', data); lru.set('b', data); expect(lru.get('a')).toBe(data)
  lru.set('c', data); expect(lru.get('b')).toBeUndefined()
  lru.set('a', data); lru.set('too-large', { ...data, values: new Uint8Array(25) })
  expect(lru.get('a')).toBe(data); expect(lru.get('c')).toBe(data); expect(lru.get('too-large')).toBeUndefined()
})
