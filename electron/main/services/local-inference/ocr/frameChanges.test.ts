import { expect, it } from 'vitest'
import { changedTiles, cropHash } from './frameChanges'
import { recognitionCrop } from './recognition'
it('单像素文字变化不漏检；只屏蔽光标足迹，同块其他文字仍触发', () => {
  const a = new Uint8Array(128 * 128 * 3), b = a.slice()
  b[(20 * 128 + 20) * 3] = 255
  expect(changedTiles(a, b, 128, 128)).toEqual([[0, 0, .5, .5]])
  expect(changedTiles(a, b, 128, 128, [[20, 20]])).toEqual([])
  b[(5 * 128 + 5) * 3] = 255
  expect(changedTiles(a, b, 128, 128, [[20, 20]])).toHaveLength(1)
  expect(changedTiles(b, b, 128, 128)).toEqual([])
})
it('裁片哈希按像素和大小校验，滚动后相同内容可复用，改字不命中', () => {
  const rgb = new Uint8Array(128 * 128 * 3).fill(255), crop = recognitionCrop(128, 128, [0, 0, .5, .5])
  const key = cropHash(rgb, 128, crop)
  expect(cropHash(rgb, 128, { ...crop, y: 64 })).toBe(key)
  rgb[0] = 0
  expect(cropHash(rgb, 128, crop)).not.toBe(key)
})
it('原生整行预筛保留视图偏移、边缘块和所有颜色通道的单像素变化', () => {
  const a = new Uint8Array(67 * 65 * 3 + 16).subarray(8, -8), b = a.slice()
  b[b.length - 1] = 1
  expect(changedTiles(a, b, 67, 65)).toEqual([[64 / 67, 64 / 65, 3 / 67, 1 / 65]])
})
