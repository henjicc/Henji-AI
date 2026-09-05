import { describe, expect, it, vi } from 'vitest'
import {
  ImageEditResourceBudget,
  createFloat32PremultipliedRgbaTile,
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
  type ImageEditBrushTileV3,
} from '@/core/imageEdit/v3'
import type {
  ImageEditorV3RasterExportDescription,
  ImageEditorV3ResourceDescriptor,
} from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3ExportSourceTileRequest } from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { fakeSourcePyramidReader } from './renderExportTestFixtures'

const LOWER = `sha256:${'1'.repeat(64)}` as const
const UPPER = `sha256:${'2'.repeat(64)}` as const
const BRUSH_A = `sha256:${'3'.repeat(64)}` as const
const BRUSH_B = `sha256:${'4'.repeat(64)}` as const
const BRUSH_MEDIA_TYPE = 'application/x-henji-brush-tile-v3'

function description(width: number, height: number): ImageEditorV3RasterExportDescription {
  return {
    width,
    height,
    bitDepth: 8,
    sampleFormat: 'uint',
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
  }
}

function descriptor(
  resourceRef: `sha256:${string}`,
  byteLength = 120,
): ImageEditorV3ResourceDescriptor {
  return { resourceRef, byteLength, mediaType: BRUSH_MEDIA_TYPE }
}

function brushTile(
  width: number,
  height: number,
  data = new Float32Array(width * height * 4),
): ImageEditBrushTileV3 {
  return createFloat32PremultipliedRgbaTile(
    width,
    height,
    'linear-light',
    data,
    'srgb',
    'srgb',
    203,
  )
}

function sourceReader(colors: ReadonlyMap<string, readonly [number, number, number, number]>) {
  return async (request: ImageEditorV3ExportSourceTileRequest) => {
    const color = colors.get(request.resourceRef)
    if (!color) throw new Error(`missing source ${request.resourceRef}`)
    const canvasWidth = 4
    const canvasHeight = 1
    const originX = request.tileX * 512
    const originY = request.tileY * 512
    const width = Math.min(512, canvasWidth - originX)
    const height = Math.min(512, canvasHeight - originY)
    const pixels = new Uint8Array(width * height * 4)
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset)
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

async function firstTilePixels(
  stream: ReturnType<typeof renderImageEditorV3ExportTiles>,
): Promise<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) throw new Error('missing export tile')
  const pixels = first.value.pixels instanceof Uint8Array
    ? first.value.pixels
    : new Uint8Array(first.value.pixels)
  await iterator.return?.()
  return pixels
}

describe('图片编辑 V3 稀疏栅格分块导出', () => {
  it('把画笔瓦片作为图层区域完整替换，透明擦除显示下层', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 1,
      documentId: 'sparse-replacement',
      sourceResourceId: LOWER,
    })
    const upper = createImageEditRasterLayerV3('upper', '上层', UPPER)
    upper.tiles['0/0/0'] = BRUSH_A
    document.layers.push(upper)
    const data = new Float32Array(4 * 1 * 4)
    data.set([0, 0, 1, 1], 4)
    const readBrushTiles = vi.fn(async (requests: ReadonlyArray<{ tileKey: string }>) => ({
      tiles: requests.map(({ tileKey }) => ({ tileKey, tile: brushTile(4, 1, data) })),
    }))

    const pixels = await firstTilePixels(renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [descriptor(BRUSH_A)],
      description: description(4, 1),
      tileSize: 16,
    }, {
      readSourcePyramid: fakeSourcePyramidReader(new Map([
        [LOWER, { width: 4, height: 1 }], [UPPER, { width: 4, height: 1 }],
      ])),
      readSourceTile: sourceReader(new Map([
        [LOWER, [0, 255, 0, 255] as const],
        [UPPER, [255, 0, 0, 255] as const],
      ])),
      readBrushTiles,
    }))

    expect(Array.from(pixels.subarray(0, 4))).toEqual([0, 255, 0, 255])
    expect(Array.from(pixels.subarray(4, 8))).toEqual([0, 0, 255, 255])
    expect(Array.from(pixels.subarray(8, 12))).toEqual([0, 255, 0, 255])
    expect(readBrushTiles).toHaveBeenCalledWith([
      { tileKey: '0/0/0', resource: { resourceId: BRUSH_A, byteSize: 120 } },
    ], expect.any(AbortSignal))
  })

  it('每个输出块只读取 sourceRegion 相交的 mip0 画笔瓦片', async () => {
    const document = createImageEditDocumentV3({
      width: 1_024,
      height: 1,
      documentId: 'sparse-intersection',
    })
    const layer = createImageEditRasterLayerV3('paint', '画笔')
    layer.tiles = { '0/0/0': BRUSH_A, '0/1/0': BRUSH_B }
    document.layers.push(layer)
    const readBrushTiles = vi.fn(async (requests: ReadonlyArray<{ tileKey: string }>) => ({
      tiles: requests.map(({ tileKey }) => ({ tileKey, tile: brushTile(512, 1) })),
    }))
    const iterator = renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [descriptor(BRUSH_A), descriptor(BRUSH_B)],
      description: description(1_024, 1),
      tileSize: 512,
    }, { readBrushTiles })[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toMatchObject({ x: 0, width: 512 })
    expect(readBrushTiles).toHaveBeenCalledTimes(1)
    expect(readBrushTiles.mock.calls[0]?.[0]).toEqual([
      { tileKey: '0/0/0', resource: { resourceId: BRUSH_A, byteSize: 120 } },
    ])
    await iterator.return?.()
  })

  it('在输出会话前拒绝缺失 descriptor、非规范键和错误媒体类型', () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'sparse-invalid' })
    const layer = createImageEditRasterLayerV3('paint', '画笔')
    layer.tiles = { '0/0/0': BRUSH_A }
    document.layers.push(layer)
    expect(() => renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [],
      description: description(1, 1),
    })).toThrow('缺少画笔瓦片资源描述')
    expect(() => renderImageEditorV3ExportTiles({
      document: { ...document, layers: [{ ...layer, tiles: { '0:0:0': BRUSH_A } }] },
      resourceDescriptors: [descriptor(BRUSH_A)],
      description: description(1, 1),
    })).toThrow('无效画笔瓦片键')
    expect(() => renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [{ ...descriptor(BRUSH_A), mediaType: 'image/png' }],
      description: description(1, 1),
    })).toThrow('媒体类型不匹配')
  })

  it('拒绝边缘尺寸或颜色契约损坏的 RGBA Float32 瓦片', async () => {
    const document = createImageEditDocumentV3({ width: 513, height: 1, documentId: 'sparse-edge' })
    document.geometry.crop = { x: 512, y: 0, width: 1, height: 1 }
    const layer = createImageEditRasterLayerV3('paint', '画笔')
    layer.tiles = { '0/1/0': BRUSH_A }
    document.layers.push(layer)
    await expect(firstTilePixels(renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [descriptor(BRUSH_A)],
      description: description(1, 1),
    }, {
      readBrushTiles: async () => ({ tiles: [{ tileKey: '0/1/0', tile: brushTile(2, 1) }] }),
    }))).rejects.toThrow('像素契约与文档不匹配')

    const corrupted = brushTile(1, 1) as Extract<ImageEditBrushTileV3, { storage: 'rgba-float32' }>
    Object.defineProperty(corrupted, 'colorDomain', { value: 'perceptual-working' })
    await expect(firstTilePixels(renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [descriptor(BRUSH_A)],
      description: description(1, 1),
    }, {
      readBrushTiles: async () => ({ tiles: [{ tileKey: '0/1/0', tile: corrupted }] }),
    }))).rejects.toThrow('像素契约与文档不匹配')
  })

  it('取消会打断不合作的画笔 reader，并同步释放工作集 lease', async () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'sparse-cancel' })
    const layer = createImageEditRasterLayerV3('paint', '画笔')
    layer.tiles = { '0/0/0': BRUSH_A }
    document.layers.push(layer)
    const controller = new AbortController()
    const budget = new ImageEditResourceBudget()
    const readBrushTiles = vi.fn(() => new Promise<never>(() => undefined))
    const iterator = renderImageEditorV3ExportTiles({
      document,
      resourceDescriptors: [descriptor(BRUSH_A)],
      description: description(1, 1),
      signal: controller.signal,
    }, { readBrushTiles, resourceBudget: budget })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await vi.waitFor(() => expect(readBrushTiles).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })
})
