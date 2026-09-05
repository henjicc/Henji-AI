import { describe, expect, it, vi } from 'vitest'
import { DIFFUSION_V4_RECIPE_ADAPTER, ImageEditResourceBudget, createImageEditAnnotationLayerV3, createImageEditDocumentV3, createImageEditEffectLayerV3, type ImageEditDocumentV3 } from '@/core/imageEdit/v3'
import { resolveImageEditorV3ExportSourceBitDepth } from './capabilities'
import { type ImageEditorV3ExportSourceTileRequest } from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { SOURCE, FakeImage, description, annotationImpulse, collectPixels, solidImage, impulseImage, diffusionParams, fakeSourcePyramidReader } from './renderExportTestFixtures'

describe('图片编辑 V3 分块导出渲染', () => {
  it('把 SDR 权威位深与源读取精度一一映射，浮点文档保持 Float32', () => {
    const document = createImageEditDocumentV3({
      width: 1,
      height: 1,
      documentId: 'source-read-precision',
      sourceResourceId: SOURCE,
    })
    expect(resolveImageEditorV3ExportSourceBitDepth(document)).toBe(8)
    document.color.bitDepth = 16
    expect(resolveImageEditorV3ExportSourceBitDepth(document)).toBe(16)
    document.color.bitDepth = 'float16'
    document.color.transferFunction = 'linear'
    expect(resolveImageEditorV3ExportSourceBitDepth(document)).toBe(32)
    document.color.bitDepth = 'float32'
    expect(resolveImageEditorV3ExportSourceBitDepth(document)).toBe(32)
  })

  it('用图层顺序决定模糊是否作用于标注，并保持跨瓦片 halo 无接缝', async () => {
    const base = createImageEditDocumentV3({
      width: 32,
      height: 4,
      documentId: 'layer-order',
      sourceResourceId: SOURCE,
    })
    const annotation = createImageEditAnnotationLayerV3('annotation', '标注')
    const blur = createImageEditEffectLayerV3(
      'blur',
      'Gaussian Blur',
      'image.gaussian-blur-v2',
      { radius: 1 },
    )
    const images = new Map([[SOURCE, solidImage(32, 4)]])
    const below = { ...base, layers: [base.layers[0], annotation, blur] }
    const above = { ...base, layers: [base.layers[0], blur, annotation] }

    const tiled = await collectPixels(below, 16, images, annotationImpulse(15, 1))
    const single = await collectPixels(below, 32, images, annotationImpulse(15, 1))
    const clear = await collectPixels(above, 16, images, annotationImpulse(15, 1))

    expect(tiled).toEqual(single)
    expect(tiled[(1 * 32 + 14) * 4]).toBeGreaterThan(0)
    expect(clear[(1 * 32 + 14) * 4]).toBe(0)
    expect(clear[(1 * 32 + 15) * 4]).toBe(255)
  })

  it('允许迁移后的 Blur v1 在分块导出中保持旧版感知域模糊', async () => {
    const document = createImageEditDocumentV3({
      width: 32,
      height: 4,
      documentId: 'legacy-blur-export',
      sourceResourceId: SOURCE,
    })
    const annotation = createImageEditAnnotationLayerV3('annotation', '标注')
    const blur = createImageEditEffectLayerV3(
      'legacy-blur',
      '旧版模糊',
      'image.blur',
      { algorithm: 'gaussian', strength: 0.5, radiusPixels: 1 },
    )
    document.layers.push(annotation, blur)

    const output = await collectPixels(
      document,
      16,
      new Map([[SOURCE, solidImage(32, 4)]]),
      annotationImpulse(15, 1),
    )

    expect(output[(1 * 32 + 14) * 4]).toBeGreaterThan(0)
    expect(output[(1 * 32 + 15) * 4]).toBeLessThan(255)
  })

  it('柔光共享连续 mip 散射，跨瓦片输出与单瓦片一致并处理下方标注', async () => {
    const document = createImageEditDocumentV3({
      width: 32,
      height: 8,
      documentId: 'diffusion-export',
      sourceResourceId: SOURCE,
    })
    const annotation = createImageEditAnnotationLayerV3('annotation', '标注')
    const diffusion = createImageEditEffectLayerV3(
      'diffusion',
      '柔光',
      'image.diffusion',
      diffusionParams({ mode: 'glow', quality: 'realtime' }),
    )
    document.layers.push(annotation, diffusion)
    const images = new Map([[SOURCE, solidImage(32, 8)]])

    const tiled = await collectPixels(document, 16, images, annotationImpulse(15, 4))
    const single = await collectPixels(document, 32, images, annotationImpulse(15, 4))

    expect(tiled).toEqual(single)
    expect(tiled[(4 * 32 + 16) * 4]).toBeGreaterThan(0)
  })

  it('柔光导出沿用稳定帧 high recipe，透明区域保持透明黑', async () => {
    const compileRecipe = vi.spyOn(DIFFUSION_V4_RECIPE_ADAPTER, 'compileRecipe')
    const document = createImageEditDocumentV3({
      width: 16,
      height: 4,
      documentId: 'diffusion-alpha',
      sourceResourceId: SOURCE,
    })
    document.layers.push(createImageEditEffectLayerV3(
      'diffusion',
      '柔光',
      'image.diffusion',
      diffusionParams({ mode: 'white_mist', quality: 'realtime' }),
    ))
    const images = new Map<string, FakeImage>([[SOURCE, {
      width: 16,
      height: 4,
      pixel: (x) => x < 8 ? [0, 0, 0, 0] : [255, 255, 255, 255],
    }]])

    const output = await collectPixels(document, 16, images)
    expect(compileRecipe).toHaveBeenCalled()
    expect(compileRecipe.mock.calls.every(([, options]) => options.quality === 'high')).toBe(true)
    compileRecipe.mockRestore()
    for (let x = 0; x < 8; x += 1) {
      expect(Array.from(output.subarray(x * 4, x * 4 + 4))).toEqual([0, 0, 0, 0])
    }
  })

  it('变换内容位于柔光下方时，全局分析与最终瓦片使用同一位置语义', async () => {
    const create = (translation: number): ImageEditDocumentV3 => {
      const document = createImageEditDocumentV3({
        width: 32,
        height: 1,
        documentId: `diffusion-transform-${translation}`,
        sourceResourceId: SOURCE,
      })
      document.layers[0].transform = [1, 0, 0, 1, translation, 0]
      document.layers.push(createImageEditEffectLayerV3(
        'diffusion',
        '柔光',
        'image.diffusion',
        diffusionParams(),
      ))
      return document
    }
    const image = impulseImage(32, 1, 8, 0)
    const baseline = await collectPixels(create(0), 16, new Map([[SOURCE, image]]))
    const translated = await collectPixels(create(2), 16, new Map([[SOURCE, image]]))
    const peak = (pixels: Uint8Array): number => {
      let index = 0
      for (let x = 1; x < 32; x += 1) {
        if (pixels[x * 4] > pixels[index * 4]) index = x
      }
      return index
    }
    expect(peak(translated)).toBe(peak(baseline) + 2)
  })

  it('Gaussian 半径 17 的金字塔相位不随导出瓦片边界改变', async () => {
    const document = createImageEditDocumentV3({
      width: 80,
      height: 1,
      documentId: 'gaussian-pyramid-phase',
      sourceResourceId: SOURCE,
    })
    document.layers.push(createImageEditEffectLayerV3(
      'blur',
      '高斯模糊',
      'image.gaussian-blur-v2',
      { radius: 17 },
    ))
    const gradient: FakeImage = {
      width: 80,
      height: 1,
      pixel: (x) => [x * 3, x * 2, x, 255],
    }
    const single = await collectPixels(document, 80, new Map([[SOURCE, gradient]]))
    const tiled = await collectPixels(document, 16, new Map([[SOURCE, gradient]]))
    expect(tiled).toEqual(single)
  })

  it('快速模糊的大半径共享整图分析，跨瓦片输出与单瓦片完全一致', async () => {
    const document = createImageEditDocumentV3({
      width: 96,
      height: 16,
      documentId: 'fast-blur-global-analysis',
      sourceResourceId: SOURCE,
    })
    document.layers.push(createImageEditEffectLayerV3(
      'fast-blur',
      '模糊',
      'image.fast-blur-v3',
      { radius: 20 },
    ))
    const images = new Map([[SOURCE, impulseImage(96, 16, 47, 8)]])

    const single = await collectPixels(document, 96, images)
    const tiled = await collectPixels(document, 16, images)

    expect(tiled).toEqual(single)
    expect(tiled[(8 * 96 + 48) * 4]).toBeGreaterThan(0)
  })

  it('200MP 柔光先读受限源 mip 建共享散射，再按 512 瓦片读取原图', async () => {
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: '200mp-diffusion',
      sourceResourceId: SOURCE,
    })
    document.layers.push(createImageEditEffectLayerV3(
      'diffusion',
      '柔光',
      'image.diffusion',
      diffusionParams({ mode: 'black_mist', quality: 'realtime' }),
    ))
    const requests: ImageEditorV3ExportSourceTileRequest[] = []
    const budget = new ImageEditResourceBudget()
    const readSourceTile = async (request: ImageEditorV3ExportSourceTileRequest) => {
      requests.push(request)
      const levelWidth = Math.ceil(20_000 / (2 ** request.mip))
      const levelHeight = Math.ceil(10_000 / (2 ** request.mip))
      const originX = request.tileX * 512
      const originY = request.tileY * 512
      const width = Math.min(512, levelWidth - originX)
      const height = Math.min(512, levelHeight - originY)
      const pixels = new Uint8Array(width * height * 4)
      for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([32, 32, 32, 255], offset)
      return {
        resourceRef: request.resourceRef,
        mip: request.mip,
        tileX: request.tileX,
        tileY: request.tileY,
        halo: request.halo,
        width,
        height,
        channels: 4 as const,
        bitDepth: 8 as const,
        sampleFormat: 'uint' as const,
        numericRange: 'unorm8' as const,
        byteOrder: 'little-endian' as const,
        rowStride: width * 4,
        colorSpace: 'srgb' as const,
        transferFunction: 'srgb' as const,
        alphaMode: 'straight' as const,
        orientationApplied: true as const,
        originX,
        originY,
        pixels: pixels.buffer,
      }
    }
    const iterator = renderImageEditorV3ExportTiles(
      { document, resourceDescriptors: [], description: description(20_000, 10_000), tileSize: 512 },
      { readSourceTile, readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(20_000, 10_000)]])), resourceBudget: budget },
    )[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toMatchObject({ x: 0, y: 0, width: 512, height: 512 })
    expect(requests.some((request) => request.mip === 4)).toBe(true)
    expect(requests.some((request) => request.mip === 0 && request.tileX === 0 && request.tileY === 0)).toBe(true)
    expect(requests.every((request) => request.halo === 0)).toBe(true)
    await iterator.return?.()
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })

})
