import { describe, expect, it } from 'vitest'

import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import {
  ImageEditSingularTransformErrorV3,
  resampleImageEditMaskAffineV3,
  resampleImageEditRgbaAffineV3,
  resolveImageEditInverseSourceRectV3,
} from './affineTransform'

const REGION = { x: 0, y: 0, width: 2, height: 2 }

function rgba(values: readonly number[]) {
  const data = new Float32Array(2 * 2 * 4)
  values.forEach((value, pixel) => data.set([value, 0, 0, 1], pixel * 4))
  return createFloat32PremultipliedRgbaTile(2, 2, 'linear-light', data)
}

function red(tile: ReturnType<typeof rgba>): number[] {
  return Array.from({ length: 4 }, (_, pixel) => tile.data[pixel * 4])
}

describe('图片编辑 V3 共享仿射逆采样', () => {
  it('平移使用透明边缘并让蒙版与内容保持同一变换', () => {
    const transform = [1, 0, 0, 1, 1, 0] as const
    const content = resampleImageEditRgbaAffineV3(rgba([1, 2, 3, 4]), REGION, REGION, transform)
    const mask = resampleImageEditMaskAffineV3(
      createFloat32MaskTile(2, 2, new Float32Array([0.25, 0.5, 0.75, 1])),
      REGION,
      REGION,
      transform,
    )

    expect(red(content)).toEqual([0, 1, 0, 3])
    expect([...mask.data]).toEqual([0, 0.25, 0, 0.75])
    expect(content.data[3]).toBe(0)
  })

  it('90° 旋转按全局像素中心逆采样，分块边界不改变结果', () => {
    const transform = [0, 1, -1, 0, 2, 0] as const
    expect(red(resampleImageEditRgbaAffineV3(
      rgba([1, 2, 3, 4]),
      REGION,
      REGION,
      transform,
    ))).toEqual([3, 1, 4, 2])
    expect(resolveImageEditInverseSourceRectV3(
      { x: 1, y: 0, width: 1, height: 2 },
      transform,
      { width: 2, height: 2 },
    )).toEqual({ x: 0, y: 0, width: 2, height: 1 })
  })

  it('缩放进行双线性逆采样，奇异矩阵在取样前明确拒绝', () => {
    const scaled = resampleImageEditRgbaAffineV3(
      rgba([1, 2, 3, 4]),
      REGION,
      REGION,
      [2, 0, 0, 2, 0, 0],
    )
    expect(scaled.data[0]).toBeCloseTo(0.5625, 5)
    expect(() => resampleImageEditRgbaAffineV3(
      rgba([1, 2, 3, 4]),
      REGION,
      REGION,
      [0, 0, 0, 1, 0, 0],
    )).toThrow(ImageEditSingularTransformErrorV3)
  })
})
