import { afterEach, expect, it, vi } from 'vitest'
import { readVideoEditTrackingRgb } from './videoEditTrackingPixels'

afterEach(() => { vi.unstubAllGlobals() })
it('跟踪像素在Worker按请求尺寸缩放，透明合黑底且释放读回画布', () => {
  const drawImage = vi.fn(); const canvases: Array<{ width: number; height: number }> = []
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) { canvases.push(this) }
    getContext() { return { drawImage, getImageData: () => ({ data: Uint8ClampedArray.from([200, 100, 50, 128, 80, 40, 20, 0]) }) } }
  })
  const picture = {} as OffscreenCanvas
  expect([...readVideoEditTrackingRgb(picture, { width: 2, height: 1 })]).toEqual([100, 50, 25, 0, 0, 0])
  expect(drawImage).toHaveBeenCalledWith(picture, 0, 0, 2, 1)
  expect(canvases[0]).toMatchObject({ width: 1, height: 1 })
  expect(() => readVideoEditTrackingRgb(picture, { width: 8192, height: 8192 })).toThrow('尺寸')
})
