import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@/core/types'

import { prepareUpscalePreflight } from './upscalePolicy'

const TOPAZ_MODEL = {
  meta: { canonicalModelId: 'topaz-image-upscale' },
  params: [{ id: 'falTopazUpscaleFactor', transferKey: 'upscaleFactor', default: 2 }],
} as unknown as ModelDefinition

const TOPAZ_TRANSPARENT_MODEL = {
  meta: { canonicalModelId: 'topaz-transparent-upscale' },
  params: [],
} as unknown as ModelDefinition

const SEEDVR2_MODEL = {
  meta: { canonicalModelId: 'seedvr2-image-upscale' },
  params: [{ id: 'falSeedvr2UpscaleFactor', transferKey: 'upscaleFactor', default: 2 }],
} as unknown as ModelDefinition

const BRIA_MODEL = {
  meta: { canonicalModelId: 'bria-creative-upscale' },
  params: [],
} as unknown as ModelDefinition

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
  it('按模型参数计算输出尺寸与通用运行时计价参数', () => {
    expect(prepareUpscalePreflight(imageInfo(), TOPAZ_MODEL, {
      falTopazUpscaleFactor: 2,
    })).toMatchObject({
      factor: 2,
      sourceWidth: 2000,
      sourceHeight: 1000,
      outputWidth: 4000,
      outputHeight: 2000,
      outputMegapixels: 8,
      runtimeParams: {
        __upscaleInputMegapixels: 2,
        __upscaleOutputMegapixels: 8,
      },
    })
    expect(prepareUpscalePreflight(
      imageInfo({ width: 2000, height: 1500 }),
      TOPAZ_MODEL,
      { falTopazUpscaleFactor: 4 },
    )).toMatchObject({
      outputWidth: 8000,
      outputHeight: 6000,
      outputMegapixels: 48,
    })
  })

  it('按 EXIF 5～8 方向交换视觉宽高', () => {
    expect(prepareUpscalePreflight(
      imageInfo({ width: 1200, height: 800, orientation: 6 }),
      TOPAZ_MODEL,
      { falTopazUpscaleFactor: 2 },
    )).toMatchObject({
      sourceWidth: 800,
      sourceHeight: 1200,
      outputWidth: 1600,
      outputHeight: 2400,
    })
  })

  it('按不同模型执行固定倍率与输出上限', () => {
    expect(prepareUpscalePreflight(
      imageInfo({ hasAlpha: true }),
      TOPAZ_TRANSPARENT_MODEL,
      {},
    )).toMatchObject({ factor: 4, outputWidth: 8000, outputHeight: 4000 })
    expect(() => prepareUpscalePreflight(
      imageInfo({ width: 2000, height: 1500 }),
      BRIA_MODEL,
      {},
    )).toThrow(/12\.00MP.*10MP.*尚未上传/)
  })

  it('拒绝超过 Topaz 48MP 的任务并在上传前给出预计尺寸', () => {
    expect(() => prepareUpscalePreflight(
      imageInfo({ width: 2400, height: 1600 }),
      TOPAZ_MODEL,
      { falTopazUpscaleFactor: 4 },
    )).toThrow(/9600×6400.*61\.44MP.*48MP.*尚未上传/)
  })

  it('按模型处理文件大小和透明通道限制', () => {
    expect(() => prepareUpscalePreflight(
      imageInfo({ fileSizeBytes: 20 * 1024 * 1024 + 1 }),
      TOPAZ_MODEL,
      {},
    )).toThrow(/超过 20MiB.*尚未上传/)
    expect(() => prepareUpscalePreflight(
      imageInfo({ hasAlpha: true }),
      SEEDVR2_MODEL,
      {},
    )).toThrow(/Topaz 透明图放大或 Bria/)
  })

  it('拒绝非法倍率、缺失尺寸和无法读取的文件大小', () => {
    expect(() => prepareUpscalePreflight(
      imageInfo(),
      TOPAZ_MODEL,
      { falTopazUpscaleFactor: 3 },
    )).toThrow(/放大倍率无效/)
    expect(() => prepareUpscalePreflight(
      imageInfo({ width: 0 }),
      TOPAZ_MODEL,
      {},
    )).toThrow(/无法读取源图宽度/)
    expect(() => prepareUpscalePreflight(
      imageInfo({ fileSizeBytes: 0 }),
      TOPAZ_MODEL,
      {},
    )).toThrow(/文件大小/)
  })
})
