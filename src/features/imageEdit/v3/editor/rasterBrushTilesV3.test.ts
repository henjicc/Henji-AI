import { describe, expect, it, vi } from 'vitest'

import { createImageEditHdrMetadataV3 } from '@/core/imageEdit/v3/colorTypes'
import {
  createImageEditDocumentV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { decodeSrgbExtended } from '@/core/imageEdit/v3/execution/tileColor'
import { resolveImageEditorRasterBrushLayerV3 } from './rasterBrushLayerV3'
import {
  createImageEditorRasterBrushTargetV3,
  createImageEditorRasterBrushTileLoaderV3,
} from './rasterBrushTilesV3'

describe('图片编辑 V3 栅格画笔瓦片读取', () => {
  it('没有稀疏覆盖时读取源图边缘瓦片并转为文档工作空间的 Float32 预乘像素', async () => {
    const sourceId = `sha256:${'c'.repeat(64)}`
    const document = createImageEditDocumentV3({ width: 513, height: 1, sourceResourceId: sourceId })
    const layer = document.layers[0]
    if (layer.type !== 'raster') throw new Error('测试预期栅格图层')
    const readSourceTile = vi.fn(async () => ({
      resourceRef: sourceId as `sha256:${string}`,
      mip: 0,
      tileX: 1,
      tileY: 0,
      halo: 0,
      width: 1,
      height: 1,
      channels: 4 as const,
      bitDepth: 8 as const,
      sampleFormat: 'uint' as const,
      numericRange: 'unorm8' as const,
      byteOrder: 'little-endian' as const,
      rowStride: 4,
      colorSpace: 'srgb' as const,
      transferFunction: 'srgb' as const,
      alphaMode: 'straight' as const,
      orientationApplied: true as const,
      originX: 512,
      originY: 0,
      pixels: Uint8Array.from([128, 64, 32, 128]).buffer,
    }))
    const loadTile = createImageEditorRasterBrushTileLoaderV3({
      document,
      layer,
      resourceByteSizes: new Map(),
      readSourceTile,
    })

    const snapshot = await loadTile({ mip: 0, x: 1, y: 0 }, new AbortController().signal)
    expect(readSourceTile).toHaveBeenCalledOnce()
    expect(snapshot.resource).toBeNull()
    expect(snapshot.tile).toMatchObject({
      storage: 'rgba-float32',
      width: 1,
      height: 1,
      colorDomain: 'linear-light',
      workingSpace: document.color.workingSpace,
      transferFunction: document.color.transferFunction,
    })
    const alpha = 128 / 255
    expect(snapshot.tile.data[0]).toBeCloseTo(decodeSrgbExtended(128 / 255) * alpha, 6)
    expect(snapshot.tile.data[3]).toBeCloseTo(alpha, 6)
  })

  it('已有画笔瓦片必须带真实 byteSize，并把旧引用交给后续 CAS/历史', async () => {
    const resourceId = `sha256:${'d'.repeat(64)}`
    const document = createImageEditDocumentV3({ width: 16, height: 16 })
    const layer = createImageEditRasterLayerV3('raster', '栅格')
    layer.tiles['0/0/0'] = resourceId
    document.layers = [layer]
    const readBrushTile = vi.fn(async () => createFloat32PremultipliedRgbaTile(
      16,
      16,
      'linear-light',
      new Float32Array(16 * 16 * 4),
    ))

    const missingSizeLoader = createImageEditorRasterBrushTileLoaderV3({
      document,
      layer,
      resourceByteSizes: new Map(),
      readBrushTile,
    })
    await expect(missingSizeLoader(
      { mip: 0, x: 0, y: 0 },
      new AbortController().signal,
    )).rejects.toThrow('缺少画笔瓦片大小')
    expect(readBrushTile).not.toHaveBeenCalled()

    const loadTile = createImageEditorRasterBrushTileLoaderV3({
      document,
      layer,
      resourceByteSizes: new Map([[resourceId, 123]]),
      readBrushTile,
    })
    const snapshot = await loadTile({ mip: 0, x: 0, y: 0 }, new AbortController().signal)
    expect(readBrushTile).toHaveBeenCalledWith(
      '0/0/0',
      { resourceId, byteSize: 123 },
      expect.any(AbortSignal),
    )
    expect(snapshot.resource).toEqual({ resourceId, byteSize: 123 })
  })

  it('只允许编辑单个、可见、未锁定且变换可逆的栅格图层', () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64 })
    const group = createImageEditGroupLayerV3('group', '组')
    const layer = createImageEditRasterLayerV3('raster', '栅格')
    layer.transform = [1, 0, 0, 1, 5, 6]
    group.transform = [2, 0, 0, 2, 0, 0]
    group.children = [layer]
    document.layers = [group]

    const ready = resolveImageEditorRasterBrushLayerV3(document, [layer.id])
    expect(ready).toMatchObject({ ready: true })
    expect(ready.ready && ready.target.matrix).toEqual([2, 0, 0, 2, 10, 12])
    group.locked = true
    expect(resolveImageEditorRasterBrushLayerV3(document, [layer.id])).toEqual({
      ready: false,
      reason: 'locked',
    })
    expect(resolveImageEditorRasterBrushLayerV3(document, [])).toEqual({
      ready: false,
      reason: 'select-one',
    })
  })

  it('画笔目标固定使用文档颜色契约与不透明黑色', () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1 })
    document.color.workingSpace = 'display-p3'
    expect(createImageEditorRasterBrushTargetV3(document)).toMatchObject({
      colorDomain: 'linear-light',
      workingSpace: 'display-p3',
      premultipliedColor: [0, 0, 0, 1],
    })

    document.color = {
      workingSpace: 'rec2020',
      bitDepth: 16,
      transferFunction: 'pq',
      hdrMetadata: {
        ...createImageEditHdrMetadataV3('pq'),
        referenceWhiteNits: 250,
      },
      iccProfileResourceId: null,
    }
    expect(createImageEditorRasterBrushTargetV3(document).referenceWhiteNits).toBe(250)
  })
})
