import { describe, expect, it } from 'vitest'

import { createDefaultVgpuGlowOperationParams } from '../../vgpuGlowParams'
import { compileVgpuGlowRecipe } from '../../vgpuGlowRecipe'
import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from './contracts'
import { applyVgpuGlowV4, buildVgpuGlowScatterV4 } from './vgpuGlow'

function impulse(size: number) {
  const data = new Float32Array(size * size * 4)
  const offset = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4
  data.set([1, 1, 1, 1], offset)
  return createFloat32PremultipliedRgbaTile(size, size, 'linear-light', data)
}

function recipe(size: number) {
  return compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), {
    width: size,
    height: size,
  })
}

describe('辉光 Pro Float32 CPU 参考内核', () => {
  it('黑色透明输入保持严格透明且所有通道有限', () => {
    const source = createFloat32PremultipliedRgbaTile(
      9, 9, 'linear-light', new Float32Array(9 * 9 * 4),
    )
    const output = applyVgpuGlowV4(source, recipe(9), { dither: false })

    expect([...output.data].every(Number.isFinite)).toBe(true)
    expect(Math.max(...output.data)).toBe(0)
  })

  it('亮源建立归一的多尺度散射并在透明邻域生成光层', () => {
    const source = impulse(17)
    const scatter = buildVgpuGlowScatterV4(source, recipe(17))
    const output = applyVgpuGlowV4(source, recipe(17), { dither: false })
    const neighbor = (8 * 17 + 7) * 4

    expect(scatter.width).toBe(9)
    expect(scatter.height).toBe(9)
    expect(output.data[neighbor]).toBeGreaterThan(0)
    expect(output.data[neighbor + 3]).toBeGreaterThan(0)
    expect([...output.data].every(Number.isFinite)).toBe(true)
  })

  it('零蒙版逐通道返回原始预乘像素', () => {
    const source = impulse(9)
    const output = applyVgpuGlowV4(source, recipe(9), {
      dither: false,
      mask: createFloat32MaskTile(9, 9, new Float32Array(81)),
    })

    expect(output.data).toEqual(source.data)
  })
})
