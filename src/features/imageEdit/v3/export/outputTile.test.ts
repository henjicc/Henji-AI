import { describe, expect, it } from 'vitest'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3'
import { encodeImageEditorV3RenderedOutputTile } from './outputTile'

describe('图片编辑 V3 导出像素编码', () => {
  it('将线性预乘像素明确转为 16-bit little-endian straight RGBA', () => {
    const tile = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([0.25, 0.125, 0, 0.5]),
    )
    const output = encodeImageEditorV3RenderedOutputTile(tile, {
      x: 0, y: 0, width: 1, height: 1,
    }, {
      width: 1,
      height: 1,
      bitDepth: 16,
      sampleFormat: 'uint',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
    })
    const bytes = output.pixels as Uint8Array
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(output.rowStride).toBe(8)
    expect(view.getUint16(0, true)).toBeGreaterThan(48_000)
    expect(view.getUint16(2, true)).toBeGreaterThan(35_000)
    expect(view.getUint16(4, true)).toBe(0)
    expect(view.getUint16(6, true)).toBe(32_768)
  })

  it('为线性 float32 BigTIFF 保留负值与超白，不静默裁成 8 位', () => {
    const tile = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([-0.25, 1.5, 0.5, 1]),
      'srgb',
      'linear',
    )
    const output = encodeImageEditorV3RenderedOutputTile(tile, {
      x: 0, y: 0, width: 1, height: 1,
    }, {
      width: 1,
      height: 1,
      bitDepth: 32,
      sampleFormat: 'float',
      colorSpace: 'srgb',
      transferFunction: 'linear',
      alphaMode: 'straight',
    })
    const bytes = output.pixels as Uint8Array
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(output.rowStride).toBe(16)
    expect(view.getFloat32(0, true)).toBeCloseTo(-0.25)
    expect(view.getFloat32(4, true)).toBeCloseTo(1.5)
    expect(view.getFloat32(8, true)).toBeCloseTo(0.5)
    expect(view.getFloat32(12, true)).toBe(1)
  })
})
