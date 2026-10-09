import { describe, expect, it } from 'vitest'
import { encodeImageEditSelectionMaskV3, imageEditSubjectRegionSchemaV3 } from './subjectSelection'
import { appendImageEditSelectionV3, imageEditSelectionSessionSchemaV3 } from './selection/session'
import { rasterizeImageEditSessionRegionV3 } from './selection/sessionRaster'

describe('模型主体遮罩进入独立选区', () => {
  it('RLE软边保持，比例仿射映射后可以加减交、反选且逐块一致', () => {
    const mask = encodeImageEditSelectionMaskV3(Uint8Array.of(255, 128, 0, 0), 2, 2)
    mask.matrix = [0.5, 0, 0, 0.5, 0.25, 0.25]
    const selection = appendImageEditSelectionV3(null, mask, 'replace')
    const raster = (value: typeof selection) => rasterizeImageEditSessionRegionV3(value, { width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 })
    const values = raster(selection)
    expect(values[5]).toBe(1); expect(values[6]).toBeCloseTo(128 / 255); expect(values[0]).toBe(0)
    const subtraction = appendImageEditSelectionV3(selection, { type: 'rectangle', x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, 'subtract')
    expect(raster(subtraction)[5]).toBe(0); expect(raster(subtraction)[6]).toBeCloseTo(128 / 255)
    const intersection = appendImageEditSelectionV3(selection, { type: 'rectangle', x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, 'intersect')
    expect(raster(intersection)[5]).toBe(1); expect(raster(intersection)[6]).toBe(0)
    const right = rasterizeImageEditSessionRegionV3(selection, { width: 4, height: 4 }, { x: 2, y: 0, width: 2, height: 4 })
    expect(right[2]).toBe(values[6]); expect(raster({ ...selection, inverted: true })[0]).toBe(1)
  })
  it('拒绝重叠/越界的RLE、奇异坐标、错长度和越界提示', () => {
    const mask = encodeImageEditSelectionMaskV3(Uint8Array.of(255), 1, 1), selection = appendImageEditSelectionV3(null, mask, 'replace')
    for (const invalid of [{ ...mask, runs: [[0, 2, 255]] }, { ...mask, runs: [[0, 1, 255], [0, 1, 255]] }, { ...mask, matrix: [0, 0, 0, 0, 0, 0] }, { ...mask, matrix: [1e308, 0, 0, 1e308, 0, 0] }]) {
      expect(imageEditSelectionSessionSchemaV3.safeParse({ ...selection, operations: [{ shape: invalid, combine: 'replace', invertBefore: false }] }).success).toBe(false)
    }
    expect(() => encodeImageEditSelectionMaskV3(Uint8Array.of(1), 2, 2)).toThrow()
    expect(imageEditSubjectRegionSchemaV3.safeParse({ kind: 'point', points: [{ x: 2, y: 0.5 }] }).success).toBe(false)
  })
})
