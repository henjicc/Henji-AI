import { describe, expect, it } from 'vitest'

import {
  UPSCALE_INPUT_MAX_FILE_BYTES,
  prepareUpscalePreflight,
} from './upscalePolicy'

function imageInfo(overrides: Partial<Parameters<typeof prepareUpscalePreflight>[0]> = {}) {
  return {
    width: 2000,
    height: 1000,
    fileSizeBytes: 2 * 1024 * 1024,
    orientation: null,
    hasAlpha: false,
    ...overrides,
  }
}

describe('高清放大提交前预检', () => {
  it('计算 2×/4× 输出像素、精确价格阶梯与运行时计价参数', () => {
    expect(prepareUpscalePreflight(imageInfo(), 2)).toMatchObject({
      factor: 2,
      sourceWidth: 2000,
      sourceHeight: 1000,
      outputWidth: 4000,
      outputHeight: 2000,
      outputMegapixels: 8,
      estimatedPriceUsd: 0.08,
      pricingTier: 'up-to-24mp',
      runtimeParams: { __falTopazOutputMegapixels: 8 },
    })
    expect(prepareUpscalePreflight(imageInfo({ width: 2000, height: 1500 }), 4)).toMatchObject({
      outputWidth: 8000,
      outputHeight: 6000,
      outputMegapixels: 48,
      estimatedPriceUsd: 0.16,
    })
  })

  it('按 EXIF 5～8 方向交换视觉宽高', () => {
    expect(prepareUpscalePreflight(imageInfo({ width: 1200, height: 800, orientation: 6 }), 2))
      .toMatchObject({
        sourceWidth: 800,
        sourceHeight: 1200,
        outputWidth: 1600,
        outputHeight: 2400,
      })
  })

  it('拒绝超过 48MP 的任务并在上传前给出预计尺寸', () => {
    expect(() => prepareUpscalePreflight(imageInfo({ width: 2400, height: 1600 }), 4))
      .toThrow(/9600×6400.*61\.44MP.*48MP.*尚未上传/)
  })

  it('拒绝超限文件和透明通道，避免付费后才发现不兼容', () => {
    expect(() => prepareUpscalePreflight(imageInfo({
      fileSizeBytes: UPSCALE_INPUT_MAX_FILE_BYTES + 1,
    }), 2)).toThrow(/超过 20MiB.*尚未上传/)
    expect(() => prepareUpscalePreflight(imageInfo({ hasAlpha: true }), 2))
      .toThrow(/JPEG.*透明通道/)
  })

  it('拒绝非法倍率、缺失尺寸和无法读取的文件大小', () => {
    expect(() => prepareUpscalePreflight(imageInfo(), 3)).toThrow(/2× 或 4×/)
    expect(() => prepareUpscalePreflight(imageInfo({ width: 0 }), 2)).toThrow(/无法读取源图宽度/)
    expect(() => prepareUpscalePreflight(imageInfo({ fileSizeBytes: 0 }), 2)).toThrow(/文件大小/)
  })

  it('24MP 边界使用低价阶梯，超过后使用 48MP 阶梯', () => {
    expect(prepareUpscalePreflight(imageInfo({ width: 3000, height: 2000 }), 2))
      .toMatchObject({ outputMegapixels: 24, estimatedPriceUsd: 0.08 })
    expect(prepareUpscalePreflight(imageInfo({ width: 3001, height: 2000 }), 2))
      .toMatchObject({ estimatedPriceUsd: 0.16, pricingTier: 'up-to-48mp' })
  })
})
