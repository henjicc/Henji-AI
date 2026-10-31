import { expect, it } from 'vitest'
import { compareVideoEditEffectPixels } from './effectPixelReview'

it('细小单像素变化算效果生效，重复基准变化单独标为不稳定', () => {
  const on = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
  const off = on.slice(); off[4] = 1
  expect(compareVideoEditEffectPixels(on, on, on, 2, 1)).toMatchObject({ changedPixels: 0, unstablePixels: 0 })
  expect(compareVideoEditEffectPixels(on, off, on, 2, 1)).toMatchObject({ changedPixels: 1, unstablePixels: 0 })
  expect(compareVideoEditEffectPixels(on, off, on, 2, 1)).toMatchObject({ changedPixelRatio: .5, maxChannelDifference: 1 / 255, meanChannelDifference: 1 / (8 * 255) })
  expect(compareVideoEditEffectPixels(on, off, off, 2, 1)).toMatchObject({ changedPixels: 1, unstablePixels: 1 })
  expect(() => compareVideoEditEffectPixels(on, off, off, 1, 1)).toThrow('尺寸不一致')
})
