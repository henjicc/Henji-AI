import { describe, expect, it } from 'vitest'
import { createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { addImageEditRasterReplacementV3, createImageEditRasterReplacementV3,
  finishImageEditRasterReplacementV3, imageEditRasterBoundaryBasePointsV3,
  missingImageEditRasterBaseSamplesV3 } from './rasterTileReplacement'
import { resolveImageEditRasterSourceExtentV3, resolveImageEditRasterStorageSizeV3 } from './rasterSourceGeometry'

function tile(width: number, height: number, color: number[]) {
  const data = new Float32Array(width * height * 4)
  for (let p = 0; p < data.length; p += 4) data.set(color, p)
  return createFloat32PremultipliedRgbaTile(width, height, 'linear-light', data)
}

describe('栅格三域与稀疏像素替换', () => {
  it('独立原图几何不因可写域增大；有效范围只加入实际覆盖块', () => {
    const source = { width: 16, height: 16 }, canvas = { width: 1024, height: 1024 }
    expect(resolveImageEditRasterStorageSizeV3(source, canvas)).toEqual(canvas)
    expect(resolveImageEditRasterSourceExtentV3(source, canvas, [])).toEqual(source)
    expect(resolveImageEditRasterSourceExtentV3(source, canvas, ['0/0/0'])).toEqual({ width: 512, height: 512 })
    expect(source).toEqual({ width: 16, height: 16 })
    expect(resolveImageEditRasterStorageSizeV3({ width: 640, height: 640 }, { width: 64, height: 64 }))
      .toEqual({ width: 640, height: 640 })
  })

  it('mip0 透明擦除整块替换原图；块外像素保持原值', () => {
    const state = createImageEditRasterReplacementV3(tile(4, 1, [1, 0, 0, 1]), { x: 0, y: 0, width: 4, height: 1 }, 1)
    addImageEditRasterReplacementV3(state, tile(2, 1, [0, 0, 0, 0]), 1, 0)
    expect([...finishImageEditRasterReplacementV3(state, () => { throw new Error('mip0 不应重读底图') })])
      .toEqual([1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1])
  })

  it.each([false, true])('1024×1 薄图 mip10 跨512边界按全图中心取样，块顺序反转=%s', (reverse) => {
    const state = createImageEditRasterReplacementV3(tile(1, 1, [0, 0, 1, 1]), { x: 0, y: 0, width: 1, height: 1 }, 1024, 1024,
      { width: 1024, height: 1 })
    const chunks = [{ x: 0, color: [1, 0, 0, 1] }, { x: 512, color: [0, 1, 0, 1] }]
    for (const chunk of reverse ? chunks.reverse() : chunks) addImageEditRasterReplacementV3(state, tile(512, 1, chunk.color), chunk.x, 0)
    expect(missingImageEditRasterBaseSamplesV3(state)).toEqual([])
    expect([...finishImageEditRasterReplacementV3(state, () => 0)]).toEqual([0.5, 0.5, 0, 1])
  })

  it('跨原图和画笔边界时读取真实 mip0 底图，不能混入已滤波低 mip 底图', () => {
    const region = { x: 0, y: 0, width: 1, height: 1 }, source = { width: 1024, height: 1 }
    const points = imageEditRasterBoundaryBasePointsV3(region, 10, source, [{ x: 512, y: 0, width: 512, height: 1 }])
    expect(points.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 511, y: 0 }])
    const state = createImageEditRasterReplacementV3(tile(1, 1, [0, 0, 1, 1]), region, 1024, 1024, source)
    addImageEditRasterReplacementV3(state, tile(512, 1, [0, 0, 0, 0]), 512, 0)
    expect(missingImageEditRasterBaseSamplesV3(state)).toEqual([{ x: 511, y: 0, weight: 0.5 }])
    expect([...finishImageEditRasterReplacementV3(state, (x, y, c) => {
      expect([x, y]).toEqual([511, 0]); return c === 0 || c === 3 ? 1 : 0
    })]).toEqual([0.5, 0, 0, 0.5])
  })

  it('奇数边缘 mip 只 clamp 全图边缘，不落到图外或相邻块伪造的边缘', () => {
    const state = createImageEditRasterReplacementV3(tile(1, 1, [1, 0, 0, 1]), { x: 1, y: 0, width: 1, height: 1 }, 1024, 1024,
      { width: 1025, height: 1 })
    addImageEditRasterReplacementV3(state, tile(1, 1, [0, 1, 0, 1]), 1024, 0)
    expect([...finishImageEditRasterReplacementV3(state, () => 0)]).toEqual([0, 1, 0, 1])
  })
})
