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

function opaqueTile(width: number, height: number) {
  const data = new Float32Array(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([0.08, 0.06, 0.04, 1], offset)
  }
  return createFloat32PremultipliedRgbaTile(width, height, 'linear-light', data)
}

function sliceColumns(source: ReturnType<typeof opaqueTile>, left: number, width: number) {
  const data = new Float32Array(width * source.height * 4)
  for (let y = 0; y < source.height; y += 1) {
    const start = (y * source.width + left) * 4
    data.set(source.data.subarray(start, start + width * 4), y * width * 4)
  }
  return createFloat32PremultipliedRgbaTile(width, source.height, 'linear-light', data)
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

  it('缩放视口分块按覆盖的文档跨度采样同一张全局散射图', () => {
    const fullSource = impulse(16)
    const compiled = recipe(16)
    const scatter = buildVgpuGlowScatterV4(fullSource, compiled)
    const preview = opaqueTile(4, 2)
    const shared = {
      tile: scatter,
      documentWidth: 16,
      documentHeight: 8,
    }
    const whole = applyVgpuGlowV4(preview, compiled, {
      dither: false,
      globalScatter: {
        ...shared,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 16,
        sourceHeight: 8,
      },
    })
    const left = applyVgpuGlowV4(sliceColumns(preview, 0, 2), compiled, {
      dither: false,
      globalScatter: {
        ...shared,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 8,
        sourceHeight: 8,
      },
    })
    const right = applyVgpuGlowV4(sliceColumns(preview, 2, 2), compiled, {
      dither: false,
      globalScatter: {
        ...shared,
        sourceX: 8,
        sourceY: 0,
        sourceWidth: 8,
        sourceHeight: 8,
      },
    })

    for (let y = 0; y < preview.height; y += 1) {
      for (let x = 0; x < preview.width; x += 1) {
        const tile = x < 2 ? left : right
        const tileX = x < 2 ? x : x - 2
        const wholeOffset = (y * preview.width + x) * 4
        const tileOffset = (y * tile.width + tileX) * 4
        for (let channel = 0; channel < 4; channel += 1) {
          expect(tile.data[tileOffset + channel]).toBeCloseTo(
            whole.data[wholeOffset + channel],
            6,
          )
        }
      }
    }
  })
})
