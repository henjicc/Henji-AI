import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditHdrMetadataV3, encodeTransferFunctionV3 } from '@/core/imageEdit/v3'
import { type ImageEditorV3ExportSourceTileRequest, type ImageEditorV3VgpuGlowRuntime } from './contracts'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { SOURCE, description, hdrDescription, hdrBigTiffDescription, floatSourceReader, fakeSourceReader, solidImage, fakeSourcePyramidReader } from './renderExportTestFixtures'

describe('图片编辑 V3 导出色彩与辉光', () => {
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
        readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(16, 16)]])),
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
      { readSourceTile: floatSourceReader(requests), readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(1, 1)]])) },
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
        { readSourceTile: floatSourceReader(requests, 2), readSourcePyramid: fakeSourcePyramidReader(new Map([[SOURCE, solidImage(1, 1)]])) },
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
