import { expect, it } from 'vitest'
import { freezeWebText, webTextImageMapping, webTextSelectors } from './webTextGeometry'

it('使用实际有效图像尺寸换算非零取景，不把 DPR 或名义倍率再乘一次', () => {
  expect(webTextImageMapping([100, 50, 800, 400], 1200, 600).viewportToImage).toEqual([1.5, 0, 0, 1.5, -150, -75])
  const { viewportToImage: m } = webTextImageMapping([100, 50, 801, 401], 1201, 601)
  expect(120 * m[0] + m[4]).toBeCloseTo(20 * 1201 / 801)
  expect(70 * m[3] + m[5]).toBeCloseTo(20 * 601 / 401)
  const value = freezeWebText({ '#a': { status: 'not-found' as const } })
  expect(() => Object.assign(value['#a'], { status: 'ready' })).toThrow()
  expect(webTextSelectors(Array.from({ length: 100 }, (_, i) => `#id${i}`))).toHaveLength(100)
  expect(() => webTextSelectors([null])).toThrow('text')
})
