import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import {
  convertPreviewWorkingSpaceToSrgbDisplayV3,
  convertSrgbProxyToPreviewWorkingSpaceV3,
  describeImageEditorPreviewColorDiagnosticsV3,
} from './previewColorV3'

describe('ImageEditor V3 受控预览颜色链路', () => {
  it('Display-P3 显式往返 sRGB 预览边界且不改变 alpha', () => {
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([0.28, 0.12, 0.04, 0.5]),
    )
    const color = {
      ...createDefaultImageEditColorModeV3(),
      workingSpace: 'display-p3' as const,
      bitDepth: 16 as const,
    }
    const working = convertSrgbProxyToPreviewWorkingSpaceV3(source, color)
    const display = convertPreviewWorkingSpaceToSrgbDisplayV3(working, color)
    expect([...display.data]).toEqual(expect.arrayContaining([
      expect.closeTo(source.data[0], 5),
      expect.closeTo(source.data[1], 5),
      expect.closeTo(source.data[2], 5),
      0.5,
    ]))
    expect(describeImageEditorPreviewColorDiagnosticsV3(color)).toEqual([
      expect.stringContaining('Display-P3'),
      expect.stringContaining('16'),
    ])
  })

  it('HDR 只压缩显示副本的超白头部并给出明确 SDR 诊断', () => {
    const hdr = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([4, 2, 1, 1]),
    )
    const color = {
      ...createDefaultImageEditColorModeV3(),
      workingSpace: 'rec2020' as const,
      transferFunction: 'pq' as const,
      bitDepth: 'float16' as const,
      hdrMetadata: { standard: 'pq' as const, maxLuminanceNits: 1_000 },
    }
    const display = convertPreviewWorkingSpaceToSrgbDisplayV3(hdr, color)
    const displayLuminance = display.data[0] * 0.2126
      + display.data[1] * 0.7152
      + display.data[2] * 0.0722
    expect(displayLuminance).toBeLessThan(1)
    expect(describeImageEditorPreviewColorDiagnosticsV3(color)).toEqual([
      expect.stringContaining('Rec.2020'),
      expect.stringContaining('HDR'),
      expect.stringContaining('float16'),
    ])
    expect(hdr.data[0]).toBe(4)
  })

  it('普通 8-bit sRGB 不制造颜色降级诊断', () => {
    expect(describeImageEditorPreviewColorDiagnosticsV3(
      createDefaultImageEditColorModeV3(),
    )).toEqual([])
  })

  it('非 HDR 感知域会先解码到线性域再转换原色和输出契约', () => {
    const perceptualP3 = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'perceptual-working',
      new Float32Array([0.8, 0.4, 0.2, 1]),
      'display-p3',
      'srgb',
      203,
    )
    const color = {
      ...createDefaultImageEditColorModeV3(),
      workingSpace: 'display-p3' as const,
    }
    const display = convertPreviewWorkingSpaceToSrgbDisplayV3(perceptualP3, color)
    expect(display.colorDomain).toBe('linear-light')
    expect(display.workingSpace).toBe('srgb')
    expect(display.transferFunction).toBe('srgb')
    expect(display.data[0]).not.toBeCloseTo(perceptualP3.data[0], 4)
  })
})
