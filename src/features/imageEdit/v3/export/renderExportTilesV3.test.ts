import { describe, expect, it, vi } from 'vitest'
import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  ImageEditResourceBudget,
  createFloat32PremultipliedRgbaTile,
  createFloat32MaskTile,
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditHdrMetadataV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditJsonObjectV3,
  createImageEditSparseMaskReferenceV3,
  encodeTransferFunctionV3,
} from '@/core/imageEdit/v3'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import {
  acquireImageEditorSessionResourceBudgetV3,
  inspectImageEditorSessionResourceBudgetV3,
} from '../execution/imageEditorSessionResourceBudgetV3'
import { resolveImageEditorV3ExportSourceBitDepth } from './capabilities'
import {
  type ImageEditorV3ExportAnnotationRasterizeRequest,
  type ImageEditorV3ExportSourceTileRequest,
  type ImageEditorV3ExportRenderDependencies,
  type ImageEditorV3VgpuGlowRuntime,
} from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'

const SOURCE = `sha256:${'1'.repeat(64)}` as const
const MASK = `sha256:${'2'.repeat(64)}` as const
const MASK_TILE = `sha256:${'3'.repeat(64)}` as const

interface FakeImage {
  width: number
  height: number
  pixel(x: number, y: number): readonly [number, number, number, number]
}

const description = (width: number, height: number): ImageEditorV3RasterExportDescription => ({
  width,
  height,
  bitDepth: 8,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
})

function hdrDescription(
  width: number,
  height: number,
  transferFunction: 'pq' | 'hlg',
): ImageEditorV3RasterExportDescription {
  return {
    width,
    height,
    bitDepth: 16,
    sampleFormat: 'uint',
    colorSpace: 'rec2020',
    transferFunction,
    alphaMode: 'straight',
    iccProfileResourceRef: null,
    cicp: {
      colorPrimaries: 9,
      transferCharacteristics: transferFunction === 'pq' ? 16 : 18,
      matrixCoefficients: 9,
      fullRange: false,
    },
    hdrMetadata: null,
  }
}

function hdrBigTiffDescription(
  width: number,
  height: number,
): ImageEditorV3RasterExportDescription {
  return {
    width,
    height,
    bitDepth: 32,
    sampleFormat: 'float',
    colorSpace: 'rec2020',
    transferFunction: 'linear',
    alphaMode: 'straight',
    iccProfileResourceRef: null,
    cicp: null,
    hdrMetadata: null,
  }
}

function floatSourceReader(
  requests: ImageEditorV3ExportSourceTileRequest[],
  straightValue = 2,
) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    requests.push(request)
    const pixels = new Float32Array([straightValue, straightValue, straightValue, 0.5])
    return {
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      width: 1,
      height: 1,
      channels: 4 as const,
      bitDepth: 32 as const,
      sampleFormat: 'float' as const,
      numericRange: 'scene-linear' as const,
      byteOrder: 'little-endian' as const,
      rowStride: 16,
      colorSpace: 'scrgb' as const,
      transferFunction: 'linear' as const,
      alphaMode: 'straight' as const,
      orientationApplied: true as const,
      originX: 0,
      originY: 0,
      pixels: pixels.buffer,
    }
  }
}

function fakeSourceReader(images: ReadonlyMap<string, FakeImage>) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    const image = images.get(request.resourceRef)
    if (!image) throw new Error(`missing fake image ${request.resourceRef}`)
    const originX = request.tileX * 512
    const originY = request.tileY * 512
    const width = Math.min(512, image.width - originX)
    const height = Math.min(512, image.height - originY)
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels.set(image.pixel(originX + x, originY + y), (y * width + x) * 4)
      }
    }
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
}

function annotationImpulse(
  x: number,
  y: number,
): (request: ImageEditorV3ExportAnnotationRasterizeRequest) => Promise<Float32PremultipliedRgbaTile> {
  return async ({ document, region }) => {
    const data = new Float32Array(region.width * region.height * 4)
    if (x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height) {
      const offset = ((y - region.y) * region.width + x - region.x) * 4
      data.set([1, 1, 1, 1], offset)
    }
    return createFloat32PremultipliedRgbaTile(
      region.width,
      region.height,
      'linear-light',
      data,
      document.color.workingSpace,
      document.color.transferFunction,
      203,
    )
  }
}

async function collectPixels(
  document: ImageEditDocumentV3,
  tileSize: number,
  images: ReadonlyMap<string, FakeImage>,
  rasterizeAnnotations?: ReturnType<typeof annotationImpulse>,
  managed?: {
    resourceDescriptors: Array<{
      resourceRef: `sha256:${string}`
      byteLength: number
      mediaType: string | null
    }>
    dependencies: Pick<ImageEditorV3ExportRenderDependencies, 'readBrushTiles'>
  },
): Promise<Uint8Array> {
  const width = document.geometry.crop?.width ?? (
    document.geometry.orientation.rotate === 90 || document.geometry.orientation.rotate === 270
      ? document.geometry.height
      : document.geometry.width
  )
  const height = document.geometry.crop?.height ?? (
    document.geometry.orientation.rotate === 90 || document.geometry.orientation.rotate === 270
      ? document.geometry.width
      : document.geometry.height
  )
  const output = new Uint8Array(width * height * 4)
  for await (const tile of renderImageEditorV3ExportTiles(
    {
      document,
      resourceDescriptors: managed?.resourceDescriptors ?? [],
      description: description(width, height),
      tileSize,
    },
    {
      readSourceTile: fakeSourceReader(images),
      rasterizeAnnotations,
      ...managed?.dependencies,
    },
  )) {
    const bytes = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels)
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.rowStride
      const targetStart = ((tile.y + row) * width + tile.x) * 4
      output.set(bytes.subarray(sourceStart, sourceStart + tile.width * 4), targetStart)
    }
  }
  return output
}

function solidImage(width: number, height: number, value = 0): FakeImage {
  return { width, height, pixel: () => [value, value, value, 255] }
}

function impulseImage(width: number, height: number, x: number, y: number): FakeImage {
  return {
    width,
    height,
    pixel: (pixelX, pixelY) => pixelX === x && pixelY === y
      ? [255, 0, 0, 255]
      : [0, 0, 0, 0],
  }
}

function diffusionParams(
  patch: Readonly<Record<string, unknown>> = {},
): ImageEditJsonObjectV3 {
  const defaults = createDefaultDiffusionOperationParams()
  return {
    ...defaults,
    tint: { ...defaults.tint },
    ...patch,
  } as unknown as ImageEditJsonObjectV3
}

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
      { readSourceTile, resourceBudget: budget },
    )[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toMatchObject({ x: 0, y: 0, width: 512, height: 512 })
    expect(requests.some((request) => request.mip === 4)).toBe(true)
    expect(requests.some((request) => request.mip === 0 && request.tileX === 0 && request.tileY === 0)).toBe(true)
    expect(requests.every((request) => request.halo === 0)).toBe(true)
    await iterator.return?.()
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })

  it('默认导出与其他编辑会话共享全局资源账本，提前结束后归还', async () => {
    const document = createImageEditDocumentV3({
      width: 1,
      height: 1,
      documentId: 'global-budget-export',
      sourceResourceId: SOURCE,
    })
    const iterator = renderImageEditorV3ExportTiles(
      {
        document,
        resourceDescriptors: [],
        description: description(1, 1),
        tileSize: 16,
        sessionId: 'global-budget-export-session',
      },
      { readSourceTile: fakeSourceReader(new Map([[SOURCE, solidImage(1, 1, 32)]])) },
    )[Symbol.asyncIterator]()

    expect(inspectImageEditorSessionResourceBudgetV3('global-budget-export-session')).toBeNull()
    expect((await iterator.next()).done).toBe(false)
    const editor = acquireImageEditorSessionResourceBudgetV3('other-editor-session', {
      consumerId: 'preview',
    })
    expect(inspectImageEditorSessionResourceBudgetV3('global-budget-export-session')).toMatchObject({
      consumers: 1,
      globalConsumers: 2,
      activeSessions: 2,
    })
    expect(inspectImageEditorSessionResourceBudgetV3('other-editor-session')?.memory.totalBytes)
      .toBeGreaterThan(0)

    await iterator.return?.()
    expect(inspectImageEditorSessionResourceBudgetV3('global-budget-export-session')).toBeNull()
    editor.release()
    expect(inspectImageEditorSessionResourceBudgetV3('other-editor-session')).toBeNull()
  })

  it('在效果层用灰度蒙版混合原结果和曝光结果', async () => {
    const document = createImageEditDocumentV3({
      width: 32,
      height: 2,
      documentId: 'masked-adjustment',
      sourceResourceId: SOURCE,
    })
    const exposure = createImageEditAdjustmentLayerV3(
      'exposure',
      '曝光',
      'exposure',
      { stops: 1, offset: 0, gamma: 1 },
    )
    exposure.mask = { resourceId: MASK, inverted: false }
    document.layers.push(exposure)
    const images = new Map<string, FakeImage>([
      [SOURCE, solidImage(32, 2, 64)],
      [MASK, { width: 32, height: 2, pixel: (x) => x < 16 ? [0, 0, 0, 255] : [255, 255, 255, 255] }],
    ])

    const output = await collectPixels(document, 16, images)
    expect(output[0]).toBe(64)
    expect(output[(31 * 4)]).toBeGreaterThanOrEqual(88)
  })

  it('效果层的稀疏 Float32 蒙版只读取相交瓦片并流式混合', async () => {
    const document = createImageEditDocumentV3({
      width: 32,
      height: 2,
      documentId: 'sparse-masked-adjustment',
      sourceResourceId: SOURCE,
    })
    const exposure = createImageEditAdjustmentLayerV3(
      'exposure', '曝光', 'exposure', { stops: 1, offset: 0, gamma: 1 },
    )
    exposure.mask = {
      ...createImageEditSparseMaskReferenceV3('sparse-mask', false, 0),
      tiles: { '0/0/0': MASK_TILE },
    }
    document.layers.push(exposure)
    const readBrushTiles = vi.fn(async (
      tiles: ReadonlyArray<{ tileKey: string }>,
    ) => ({
      tiles: tiles.map(({ tileKey }) => ({
        tileKey,
        tile: createFloat32MaskTile(
          32,
          2,
          Float32Array.from({ length: 64 }, (_, index) => index % 32 < 16 ? 0 : 1),
        ),
      })),
    }))

    const output = await collectPixels(
      document,
      16,
      new Map([[SOURCE, solidImage(32, 2, 64)]]),
      undefined,
      {
        resourceDescriptors: [{
          resourceRef: MASK_TILE,
          byteLength: 128,
          mediaType: 'application/x-henji-brush-tile-v3',
        }],
        dependencies: { readBrushTiles },
      },
    )

    expect(output[0]).toBe(64)
    expect(output[31 * 4]).toBeGreaterThanOrEqual(88)
    expect(readBrushTiles).toHaveBeenCalled()
    const requestedMaskKeys = readBrushTiles.mock.calls.flatMap(([tiles]) => tiles.map(
      (tile: { tileKey: string }) => tile.tileKey,
    ))
    expect([...new Set(requestedMaskKeys)]).toEqual(['0/0/0'])
    expect(requestedMaskKeys).toHaveLength(2)
  })

  it('按文档方向和裁剪逐像素反向取样，不建立完整输出画布', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 3,
      documentId: 'oriented-crop',
      sourceResourceId: SOURCE,
    })
    document.geometry.orientation = { rotate: 90, mirrored: true }
    document.geometry.crop = { x: 1, y: 1, width: 2, height: 3 }
    const images = new Map<string, FakeImage>([[SOURCE, {
      width: 4,
      height: 3,
      pixel: (x, y) => [x + y * 4, 0, 0, 255],
    }]])

    const output = await collectPixels(document, 16, images)
    expect([...output.filter((_, index) => index % 4 === 0)]).toEqual([6, 2, 5, 1, 4, 0])
  })

  it('200MP 文档只请求当前 512 瓦片，提前结束后释放账本', async () => {
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: '200mp',
      sourceResourceId: SOURCE,
    })
    const requests: ImageEditorV3ExportSourceTileRequest[] = []
    const budget = new ImageEditResourceBudget()
    const iterator = renderImageEditorV3ExportTiles(
      { document, resourceDescriptors: [], description: description(20_000, 10_000), tileSize: 512 },
      {
        resourceBudget: budget,
        readSourceTile: async (request, signal) => {
          requests.push(request)
          void signal
          return fakeSourceReader(new Map([[SOURCE, solidImage(20_000, 10_000)]]))(request)
        },
      },
    )[Symbol.asyncIterator]()

    const first = await iterator.next()
    expect(first.value).toMatchObject({ x: 0, y: 0, width: 512, height: 512 })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tileX: 0, tileY: 0, halo: 0 })
    await iterator.return?.()
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })

  it('协作取消后不再生产下一瓦片', async () => {
    const document = createImageEditDocumentV3({
      width: 64,
      height: 2,
      documentId: 'cancel',
      sourceResourceId: SOURCE,
    })
    const controller = new AbortController()
    const iterator = renderImageEditorV3ExportTiles(
      { document, resourceDescriptors: [], description: description(64, 2), tileSize: 16, signal: controller.signal },
      { readSourceTile: fakeSourceReader(new Map([[SOURCE, solidImage(64, 2)]])) },
    )[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('分块导出按共享仿射语义平移内容，并让组蒙版随组一起移动', async () => {
    const translated = createImageEditDocumentV3({
      width: 4,
      height: 2,
      documentId: 'translated-export',
      sourceResourceId: SOURCE,
    })
    translated.layers[0].transform = [1, 0, 0, 1, 1, 0]
    const translatedPixels = await collectPixels(
      translated,
      16,
      new Map([[SOURCE, impulseImage(4, 2, 0, 0)]]),
    )
    expect([...translatedPixels.subarray(0, 8)]).toEqual([
      0, 0, 0, 0,
      255, 0, 0, 255,
    ])

    const rotated = createImageEditDocumentV3({
      width: 2,
      height: 2,
      documentId: 'rotated-export',
      sourceResourceId: SOURCE,
    })
    rotated.layers[0].transform = [0, 1, -1, 0, 2, 0]
    const rotatedPixels = await collectPixels(rotated, 16, new Map([[SOURCE, {
      width: 2,
      height: 2,
      pixel: (x, y) => {
        const value = 10 + (y * 2 + x) * 10
        return [value, 0, 0, 255]
      },
    }]]))
    expect(Array.from({ length: 4 }, (_, pixel) => rotatedPixels[pixel * 4]))
      .toEqual([30, 10, 40, 20])

    const masked = createImageEditDocumentV3({
      width: 4,
      height: 1,
      documentId: 'translated-group-mask-export',
      sourceResourceId: SOURCE,
    })
    const group = createImageEditGroupLayerV3('group', '组')
    group.children = masked.layers
    group.transform = [1, 0, 0, 1, 1, 0]
    group.mask = { resourceId: MASK, inverted: false }
    masked.layers = [group]
    const maskImage: FakeImage = {
      width: 4,
      height: 1,
      pixel: (x) => x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    }
    const maskedPixels = await collectPixels(
      masked,
      16,
      new Map([[SOURCE, solidImage(4, 1, 255)], [MASK, maskImage]]),
    )
    expect(Array.from({ length: 4 }, (_, x) => maskedPixels[x * 4 + 3]))
      .toEqual([0, 255, 0, 0])
  })

  it('每个辉光 Pro 实例各复用一次全局分析并按图层顺序分块导出', async () => {
    const readSourceTile = vi.fn(fakeSourceReader(new Map([[SOURCE, solidImage(16, 16)]])))
    const release = vi.fn()
    const buildAnalysis = vi.fn(async () => ({ release }))
    const render = vi.fn(async ({ source }: Parameters<ImageEditorV3VgpuGlowRuntime['render']>[0]) => source)
    const dispose = vi.fn()
    const glowDocument = createImageEditDocumentV3({
      width: 16,
      height: 16,
      documentId: 'glow',
      sourceResourceId: SOURCE,
    })
    glowDocument.layers.push(createImageEditEffectLayerV3('glow', '辉光 Pro', 'image.vgpu-glow', {}))
    glowDocument.layers.push(createImageEditEffectLayerV3('glow-2', '辉光 Pro 2', 'image.vgpu-glow', {}))
    const output = []
    for await (const tile of renderImageEditorV3ExportTiles(
      { document: glowDocument, resourceDescriptors: [], description: description(16, 16) },
      {
        readSourceTile,
        createVgpuGlowRuntime: () => ({ buildAnalysis, render, dispose }),
      },
    )) output.push(tile)

    expect(output).toHaveLength(1)
    expect(buildAnalysis).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(readSourceTile).toHaveBeenCalled()
  })

  it.each([
    { transferFunction: 'pq' as const, bitDepth: 16 as const },
    { transferFunction: 'pq' as const, bitDepth: 'float16' as const },
    { transferFunction: 'pq' as const, bitDepth: 'float32' as const },
    { transferFunction: 'hlg' as const, bitDepth: 16 as const },
    { transferFunction: 'hlg' as const, bitDepth: 'float16' as const },
    { transferFunction: 'hlg' as const, bitDepth: 'float32' as const },
  ])('将 $bitDepth $transferFunction 权威文档以 Float32 线性瓦片渲染为 16-bit HDR 输出', async ({
    transferFunction,
    bitDepth,
  }) => {
    const metadata = createImageEditHdrMetadataV3(transferFunction)
    metadata.referenceWhiteNits = 250
    const hdr = createImageEditDocumentV3({
      width: 1,
      height: 1,
      documentId: `hdr-${transferFunction}-${String(bitDepth)}`,
      sourceResourceId: SOURCE,
      color: {
        workingSpace: 'rec2020',
        bitDepth,
        transferFunction,
        hdrMetadata: metadata,
        iccProfileResourceId: null,
      },
    })
    const requests: ImageEditorV3ExportSourceTileRequest[] = []
    const output = []
    for await (const tile of renderImageEditorV3ExportTiles(
      {
        document: hdr,
        resourceDescriptors: [],
        description: hdrDescription(1, 1, transferFunction),
        tileSize: 16,
      },
      { readSourceTile: floatSourceReader(requests) },
    )) output.push(tile)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.bitDepth).toBe(32)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ width: 1, height: 1, rowStride: 8 })
    const bytes = output[0]!.pixels instanceof Uint8Array
      ? output[0]!.pixels
      : new Uint8Array(output[0]!.pixels)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const expected = Math.round(Math.min(
      1,
      encodeTransferFunctionV3(2, transferFunction, 250),
    ) * 65_535)
    expect(Math.abs(view.getUint16(0, true) - expected)).toBeLessThanOrEqual(2)
    expect(view.getUint16(6, true)).toBe(Math.round(0.5 * 65_535))
  })

  it.each(['pq', 'hlg'] as const)(
    '将 %s HDR 文档导出为不裁剪超白的 scene-linear Rec.2020 Float32 BigTIFF 瓦片',
    async (transferFunction) => {
      const metadata = createImageEditHdrMetadataV3(transferFunction)
      metadata.referenceWhiteNits = 250
      metadata.contentLight = {
        maxContentLightLevelNits: 1_000,
        maxFrameAverageLightLevelNits: 400,
      }
      const hdr = createImageEditDocumentV3({
        width: 1,
        height: 1,
        documentId: `hdr-bigtiff-${transferFunction}`,
        sourceResourceId: SOURCE,
        color: {
          workingSpace: 'rec2020',
          bitDepth: 'float32',
          transferFunction,
          hdrMetadata: metadata,
          iccProfileResourceId: null,
        },
      })
      const requests: ImageEditorV3ExportSourceTileRequest[] = []
      const output = []
      for await (const tile of renderImageEditorV3ExportTiles(
        {
          document: hdr,
          resourceDescriptors: [],
          description: hdrBigTiffDescription(1, 1),
          tileSize: 16,
        },
        { readSourceTile: floatSourceReader(requests, 2) },
      )) output.push(tile)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.bitDepth).toBe(32)
      expect(output).toHaveLength(1)
      expect(output[0]).toMatchObject({ width: 1, height: 1, rowStride: 16 })
      const bytes = output[0]!.pixels instanceof Uint8Array
        ? output[0]!.pixels
        : new Uint8Array(output[0]!.pixels)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      expect(view.getFloat32(0, true)).toBeCloseTo(2)
      expect(view.getFloat32(4, true)).toBeCloseTo(2)
      expect(view.getFloat32(8, true)).toBeCloseTo(2)
      expect(view.getFloat32(12, true)).toBeCloseTo(0.5)
    },
  )

  it('在任何瓦片读取前拒绝不匹配 CICP 与尚不能写入的 HDR 元数据', async () => {
    const readSourceTile = vi.fn(floatSourceReader([]))

    const hdr = createImageEditDocumentV3({
      width: 1,
      height: 1,
      documentId: 'hdr',
      sourceResourceId: SOURCE,
      color: {
        workingSpace: 'rec2020', bitDepth: 16, transferFunction: 'pq',
        hdrMetadata: createImageEditHdrMetadataV3('pq'), iccProfileResourceId: null,
      },
    })
    await expect(async () => {
      for await (const _tile of renderImageEditorV3ExportTiles(
        {
          document: hdr,
          resourceDescriptors: [],
          description: {
            ...hdrDescription(1, 1, 'pq'),
            cicp: {
              colorPrimaries: 9,
              transferCharacteristics: 18,
              matrixCoefficients: 9,
              fullRange: false,
            },
          },
        },
        { readSourceTile },
      )) void _tile
    }).rejects.toMatchObject({ code: 'COLOR_CONTRACT_MISMATCH' })

    hdr.color.hdrMetadata!.contentLight = {
      maxContentLightLevelNits: 1_000,
      maxFrameAverageLightLevelNits: 400,
    }
    await expect(async () => {
      for await (const _tile of renderImageEditorV3ExportTiles(
        {
          document: hdr,
          resourceDescriptors: [],
          description: hdrDescription(1, 1, 'pq'),
        },
        { readSourceTile },
      )) void _tile
    }).rejects.toMatchObject({ code: 'HDR_RENDER_UNSUPPORTED' })
    expect(readSourceTile).not.toHaveBeenCalled()
  })
})
