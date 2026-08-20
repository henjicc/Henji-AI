import { describe, expect, it } from 'vitest'
import { flipRgbaRows, resolveCameraStageImageSize } from './cameraStageImage'

describe('cameraStageImage', () => {
  it('按摄像机画幅生成短边 720 的静态帧尺寸', () => {
    expect(resolveCameraStageImageSize(16 / 9)).toEqual({ width: 1280, height: 720 })
    expect(resolveCameraStageImageSize(9 / 16)).toEqual({ width: 720, height: 1280 })
  })

  it('把 WebGL 自下而上的 RGBA 行翻转为 PNG 所需顺序', () => {
    const bottomRow = [1, 2, 3, 4, 5, 6, 7, 8]
    const topRow = [9, 10, 11, 12, 13, 14, 15, 16]
    expect(Array.from(flipRgbaRows(new Uint8Array([...bottomRow, ...topRow]), 2, 2)))
      .toEqual([...topRow, ...bottomRow])
  })
})
