import { describe, expect, it } from 'vitest'
import { fitMediaDimensions } from './fitMediaDimensions'

describe('素材尺寸自动缩放目标', () => {
  it('超过总像素上限时等比缩到上限内，视频宽高取偶数', () => {
    const target = fitMediaDimensions({ maxPixels: 927408 }, { width: 1920, height: 1080 }, { even: true })!
    expect(target.width * target.height).toBeLessThanOrEqual(927408)
    expect(target.width % 2).toBe(0)
    expect(target.height % 2).toBe(0)
    expect(target.width / target.height).toBeCloseTo(16 / 9, 2)
  })

  it('合格的原样返回，太小的放大到下限', () => {
    expect(fitMediaDimensions({ maxLongSidePx: 4096 }, { width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
    expect(fitMediaDimensions({ minShortSidePx: 256 }, { width: 400, height: 200 })).toEqual({ width: 512, height: 256 })
  })

  it('比例不对、或上下限互相冲突时缩放解决不了，返回 null', () => {
    expect(fitMediaDimensions({ minAspectRatio: 0.4, maxAspectRatio: 2.5 }, { width: 3000, height: 1000 })).toBeNull()
    expect(fitMediaDimensions({ minShortSidePx: 1000, maxLongSidePx: 1200 }, { width: 2000, height: 500 })).toBeNull()
  })
})
