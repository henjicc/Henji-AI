import { describe, expect, it, vi } from 'vitest'
import { ImageEditResourceBudget, createFloat32MaskTile, createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3'
import { acquireImageEditorSessionResourceBudgetV3, inspectImageEditorSessionResourceBudgetV3 } from '../execution/imageEditorSessionResourceBudgetV3'
import { type ImageEditorV3ExportSourceTileRequest } from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { SOURCE, MASK, MASK_TILE, FakeImage, description, fakeSourceReader, collectPixels, solidImage, impulseImage, fakeSourcePyramidReader } from './renderExportTestFixtures'

describe('图片编辑 V3 导出生命周期与蒙版', () => {
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
      { readSourceTile: fakeSourceReader(new Map([[SOURCE, solidImage(1, 1, 32)]])), readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(1, 1)]])) },
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
        readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(20_000, 10_000)]])),
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
      { readSourceTile: fakeSourceReader(new Map([[SOURCE, solidImage(64, 2)]])), readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(64, 2)]])) },
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

})
