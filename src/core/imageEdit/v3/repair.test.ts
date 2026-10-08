import { describe, expect, it } from 'vitest'
import { createFloat32PremultipliedRgbaTile } from './effects/contracts'
import { copyImageEditRepairSourceV3, mergeImageEditRepairPatchV3, type ImageEditRepairBitmapV3 } from './repair'

describe('非破坏修复像素', () => {
  it('仅量化模型副本；补丁保持原 alpha、非选区精度，羽化不再次相乘', () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 0.73, 0.12345678, 0.23456789, 0.34567891, 0.71])
    const tile = createFloat32PremultipliedRgbaTile(2, 1, 'linear-light', data)
    const bitmap: ImageEditRepairBitmapV3 = { region: { x: 0, y: 0, width: 2, height: 1 }, rgba: new Uint8Array(8), mask: new Uint8Array([128, 0]) }
    copyImageEditRepairSourceV3(tile, { x: 0, y: 0 }, bitmap)
    expect(bitmap.rgba[3]).toBe(186)
    const patch = createFloat32PremultipliedRgbaTile(2, 1, 'linear-light', new Float32Array([0.4, 0.2, 0.1, 0.5, 0, 0, 0, 1]))
    const merged = mergeImageEditRepairPatchV3(tile, { x: 0, y: 0 }, patch, bitmap)
    expect(merged[0]).toBeCloseTo(0.8 * data[3])
    expect(merged[3]).toBe(data[3]); expect(merged.slice(4)).toEqual(data.slice(4))
    expect(tile.data).toEqual(data)
  })
  it('缩小的统一上下文跨瓦片取样与双线性写回没有瓦片坐标偏移', () => {
    const bitmap: ImageEditRepairBitmapV3 = { region: { x: 511, y: 0, width: 2, height: 1 }, sampleScale: 2, rgba: new Uint8Array(8), mask: new Uint8Array([255, 255]) }
    const left = createFloat32PremultipliedRgbaTile(512, 1, 'linear-light', new Float32Array(2048).fill(1))
    const right = createFloat32PremultipliedRgbaTile(512, 1, 'linear-light', new Float32Array(2048).fill(0.5))
    copyImageEditRepairSourceV3(left, { x: 0, y: 0 }, bitmap); copyImageEditRepairSourceV3(right, { x: 512, y: 0 }, bitmap)
    expect(bitmap.rgba[3]).toBe(255); expect(bitmap.rgba[7]).toBe(128)
    const target = createFloat32PremultipliedRgbaTile(2, 1, 'linear-light', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
    const guide = createFloat32PremultipliedRgbaTile(2, 1, 'linear-light', new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]))
    const full: ImageEditRepairBitmapV3 = { ...bitmap, sampleScale: 1, region: { x: 512, y: 0, width: 2, height: 1 } }
    expect(mergeImageEditRepairPatchV3(target, { x: 512, y: 0 }, guide, full, { x: 511, y: 0, scale: 2 })[0]).toBe(0.5)
  })
})
