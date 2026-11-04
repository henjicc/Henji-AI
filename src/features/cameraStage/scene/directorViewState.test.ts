import { describe, expect, it } from 'vitest'
import { directorMaxPolarAngle } from './directorViewState'

describe('directorMaxPolarAngle', () => {
  it('转到极限时机位贴着地面而不钻进去；注视点抬高时允许略低于水平仰拍', () => {
    for (const [targetHeight, distance] of [[0, 9], [1, 9], [1, 400], [30, 12]] as const) {
      const polar = directorMaxPolarAngle(targetHeight, distance)
      expect(targetHeight + distance * Math.cos(polar)).toBeGreaterThanOrEqual(0.049)
    }
    expect(directorMaxPolarAngle(1, 9)).toBeGreaterThan(Math.PI / 2)
  })
})
