import { describe, expect, it } from 'vitest'

import type { ImageEditCanvasGeometryV3 } from './documentTypes'
import {
  mapImageEditOutputPixelToSourceV3,
  mapImageEditSourcePixelToOutputV3,
  resolveImageEditOutputGeometryV3,
} from './outputGeometry'

const orientations: readonly ImageEditCanvasGeometryV3['orientation'][] = [
  { rotate: 0, mirrored: false },
  { rotate: 90, mirrored: false },
  { rotate: 180, mirrored: false },
  { rotate: 270, mirrored: false },
  { rotate: 0, mirrored: true },
  { rotate: 90, mirrored: true },
  { rotate: 180, mirrored: true },
  { rotate: 270, mirrored: true },
]

describe('图片编辑输出几何坐标', () => {
  it.each(orientations)('源坐标与输出坐标在方向 %o 下互为逆变换', (orientation) => {
    const swapsAxes = orientation.rotate === 90 || orientation.rotate === 270
    const geometry = resolveImageEditOutputGeometryV3({
      width: 13,
      height: 7,
      orientation,
      crop: {
        x: 2,
        y: 1,
        width: (swapsAxes ? 7 : 13) - 3,
        height: (swapsAxes ? 13 : 7) - 2,
      },
    })
    const outputPoints = [
      [0, 0],
      [geometry.outputWidth - 1, 0],
      [0, geometry.outputHeight - 1],
      [geometry.outputWidth - 1, geometry.outputHeight - 1],
      [1, 1],
    ] as const

    for (const [outputX, outputY] of outputPoints) {
      const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(outputX, outputY, geometry)
      expect(mapImageEditSourcePixelToOutputV3(sourceX, sourceY, geometry)).toEqual([
        outputX,
        outputY,
      ])
    }
  })

  it('裁剪只给旧输出增加平移，不改变底层源坐标', () => {
    const original = resolveImageEditOutputGeometryV3({
      width: 1_600,
      height: 1_000,
      orientation: { rotate: 0, mirrored: false },
      crop: null,
    })
    const cropped = resolveImageEditOutputGeometryV3({
      width: 1_600,
      height: 1_000,
      orientation: { rotate: 0, mirrored: false },
      crop: { x: 200, y: 100, width: 800, height: 500 },
    })
    const [sourceX, sourceY] = mapImageEditOutputPixelToSourceV3(240, 180, original)

    expect(mapImageEditSourcePixelToOutputV3(sourceX, sourceY, cropped)).toEqual([40, 80])
  })
})
