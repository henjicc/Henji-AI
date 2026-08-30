import { describe, expect, it } from 'vitest'

import {
  mapOrientedSourceRectToEncoded,
  normalizeSourceExifOrientation,
  orientedSourceDimensions,
  type SourceExifOrientation,
} from './source-orientation'

describe('source orientation geometry', () => {
  it.each([
    [1, { width: 7, height: 5 }],
    [2, { width: 7, height: 5 }],
    [3, { width: 7, height: 5 }],
    [4, { width: 7, height: 5 }],
    [5, { width: 5, height: 7 }],
    [6, { width: 5, height: 7 }],
    [7, { width: 5, height: 7 }],
    [8, { width: 5, height: 7 }],
  ] as const)('EXIF %s 给出归一化逻辑尺寸', (orientation, expected) => {
    expect(orientedSourceDimensions({ width: 7, height: 5 }, orientation)).toEqual(expected)
  })

  it.each([
    [1, { left: 1, top: 1, width: 3, height: 2 }],
    [2, { left: 3, top: 1, width: 3, height: 2 }],
    [3, { left: 3, top: 2, width: 3, height: 2 }],
    [4, { left: 1, top: 2, width: 3, height: 2 }],
    [5, { left: 1, top: 1, width: 2, height: 3 }],
    [6, { left: 1, top: 1, width: 2, height: 3 }],
    [7, { left: 4, top: 1, width: 2, height: 3 }],
    [8, { left: 4, top: 1, width: 2, height: 3 }],
  ] as const)('EXIF %s 把逻辑区域精确映射回编码区域', (orientation, expected) => {
    expect(mapOrientedSourceRectToEncoded(
      { left: 1, top: 1, width: 3, height: 2 },
      { width: 7, height: 5 },
      orientation,
    )).toEqual(expected)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8] as SourceExifOrientation[])(
    'EXIF %s 的完整逻辑边界仍映射到完整编码边界',
    (orientation) => {
      const logical = orientedSourceDimensions({ width: 7, height: 5 }, orientation)
      expect(mapOrientedSourceRectToEncoded(
        { left: 0, top: 0, ...logical },
        { width: 7, height: 5 },
        orientation,
      )).toEqual({ left: 0, top: 0, width: 7, height: 5 })
    },
  )

  it('缺失或越界的方向安全归一为 1，并拒绝越界区域', () => {
    expect(normalizeSourceExifOrientation(undefined)).toBe(1)
    expect(normalizeSourceExifOrientation(0)).toBe(1)
    expect(normalizeSourceExifOrientation(9)).toBe(1)
    expect(() => mapOrientedSourceRectToEncoded(
      { left: 4, top: 0, width: 2, height: 1 },
      { width: 7, height: 5 },
      6,
    )).toThrow('outside the source bounds')
  })
})
