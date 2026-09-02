import { describe, expect, it } from 'vitest'

import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3'
import { renderImageEditorV3FastBlurAnalysisRegion } from './fastBlurAnalysis'

describe('图片编辑 V3 模糊共享分析', () => {
  it('按文档坐标采样共享低频结果，并在采样后应用当前图层蒙版', () => {
    const analysisTile = createFloat32PremultipliedRgbaTile(
      2,
      2,
      'linear-light',
      new Float32Array([
        0.5, 0.25, 0.125, 1, 0.5, 0.25, 0.125, 1,
        0.5, 0.25, 0.125, 1, 0.5, 0.25, 0.125, 1,
      ]),
    )
    const source = createFloat32PremultipliedRgbaTile(
      4,
      1,
      'linear-light',
      new Float32Array(16),
    )
    const mask = createFloat32MaskTile(4, 1, new Float32Array([0, 1, 1, 1]))
    const result = renderImageEditorV3FastBlurAnalysisRegion(
      { tile: analysisTile, documentWidth: 8, documentHeight: 4, mip: 2 },
      { x: 0, y: 0, width: 8, height: 4 },
      source,
      mask,
    )

    expect([...result.data.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...result.data.slice(4, 8)]).toEqual([0.5, 0.25, 0.125, 1])
    expect([...result.data.slice(12, 16)]).toEqual([0.5, 0.25, 0.125, 1])
  })
})
