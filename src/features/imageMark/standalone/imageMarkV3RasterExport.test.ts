import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { createImageEditHdrMetadataV3 } from '@/core/imageEdit/v3/colorTypes'
import {
  IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS,
  type ImageEditorV3DocumentSnapshot,
} from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3RasterExportSpec,
  exportImageMarkV3Raster,
  imageMarkV3RasterExportExtension,
  listImageMarkV3RasterExportFormats,
  resolveImageMarkV3RasterExportReadiness,
} from './imageMarkV3RasterExport'

const SOURCE = `sha256:${'a'.repeat(64)}` as const
const ICC = `sha256:${'b'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'c'.repeat(64)}` as const
const tiles = {
  async *[Symbol.asyncIterator]() {
    yield { x: 0, y: 0, width: 1, height: 1, rowStride: 4, pixels: new Uint8Array(4) }
  },
}

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  render: vi.fn(),
  exportRaster: vi.fn(),
}))

vi.mock('@/features/imageEdit/v3/export', async () => {
  const actual = await vi.importActual<typeof import('@/features/imageEdit/v3/export')>(
    '@/features/imageEdit/v3/export',
  )
  return {
    ...actual,
    prepareImageEditorV3ExportRender: mocks.prepare,
    renderImageEditorV3ExportTilesWithGpu: mocks.render,
  }
})

vi.mock('@/commands/imageEditorV3Export', () => ({
  exportImageEditorV3Raster: mocks.exportRaster,
}))

function snapshot(bitDepth: 8 | 16 = 8): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({
    width: 80,
    height: 50,
    documentId: 'toolbox-document',
    sourceResourceId: SOURCE,
    color: {
      workingSpace: bitDepth === 16 ? 'display-p3' : 'srgb',
      bitDepth,
      transferFunction: 'srgb',
      hdrMetadata: null,
      iccProfileResourceId: bitDepth === 16 ? ICC : null,
    },
    idFactory: (prefix) => `${prefix}-1`,
  })
  document.revision = 4
  document.geometry.orientation = { rotate: 90, mirrored: true }
  document.geometry.crop = { x: 3, y: 4, width: 30, height: 20 }
  return {
    documentRef: 'image-edit-v3:toolbox-document',
    revision: 4,
    previewRef: null,
    document,
    history: null,
    resourceRefs: bitDepth === 16 ? [SOURCE, ICC] : [SOURCE],
    resources: [
      { resourceRef: SOURCE, byteLength: 128, mediaType: 'image/png' },
      ...(bitDepth === 16
        ? [{ resourceRef: ICC, byteLength: 64, mediaType: 'application/vnd.iccprofile' }]
        : []),
    ],
    sourceFingerprint: FINGERPRINT,
  }
}

describe('工具箱 V3 栅格分块导出', () => {
  beforeEach(() => {
    mocks.prepare.mockReset().mockReturnValue({ document: snapshot().document, plan: { nodes: [], diagnostics: [] } })
    mocks.render.mockReset().mockReturnValue(tiles)
    mocks.exportRaster.mockReset().mockResolvedValue({
      status: 'completed',
      value: {
        outputRef: 'image-export-v3:test@4:png8',
        documentRef: 'image-edit-v3:toolbox-document',
        revision: 4,
        sourceFingerprint: FINGERPRINT,
        format: 'png8',
        width: 30,
        height: 20,
      },
    })
  })

  it('按权威文档输出几何与位深构造严格 PNG 描述', () => {
    expect(createImageMarkV3RasterExportSpec(
      snapshot(8).document,
      'photo.jpeg',
      { suggestedName: 'photo-edited.png' },
    )).toEqual({
      format: 'png8',
      suggestedName: 'photo-edited.png',
      description: {
        width: 30,
        height: 20,
        bitDepth: 8,
        sampleFormat: 'uint',
        colorSpace: 'srgb',
        transferFunction: 'srgb',
        alphaMode: 'straight',
        iccProfileResourceRef: null,
        cicp: null,
        hdrMetadata: null,
      },
    })
    expect(createImageMarkV3RasterExportSpec(snapshot(16).document, 'wide.tiff')).toMatchObject({
      format: 'png16',
      description: {
        bitDepth: 16,
        colorSpace: 'display-p3',
        iccProfileResourceRef: ICC,
      },
    })
  })

  it('按文档精度精确列出 SDR 与浮点导出格式及扩展名', () => {
    expect(listImageMarkV3RasterExportFormats(snapshot(8).document)).toEqual([
      'png8', 'jpeg', 'webp', 'tiff8', 'bigtiff',
    ])
    expect(listImageMarkV3RasterExportFormats(snapshot(16).document)).toEqual([
      'png16', 'tiff16', 'avif10', 'avif12', 'bigtiff',
    ])
    const float = snapshot(16)
    float.document.color.bitDepth = 'float16'
    float.document.color.transferFunction = 'linear'
    expect(listImageMarkV3RasterExportFormats(float.document)).toEqual(['bigtiff'])
    expect(createImageMarkV3RasterExportSpec(float.document, 'float.exr', {
      format: 'bigtiff',
    })).toMatchObject({
      format: 'bigtiff',
      suggestedName: 'float-edited.tif',
      description: { bitDepth: 32, sampleFormat: 'float', transferFunction: 'linear' },
    })
    expect([
      imageMarkV3RasterExportExtension('jpeg'),
      imageMarkV3RasterExportExtension('webp'),
      imageMarkV3RasterExportExtension('png16'),
      imageMarkV3RasterExportExtension('tiff8'),
      imageMarkV3RasterExportExtension('avif12'),
      imageMarkV3RasterExportExtension('bigtiff'),
    ]).toEqual(['jpg', 'webp', 'png', 'tif', 'avif', 'tif'])
  })

  it('用同一个取消信号串联预检、分块渲染与原子输出命令', async () => {
    const source = snapshot(8)
    const controller = new AbortController()
    const onProgress = vi.fn()

    await expect(exportImageMarkV3Raster({
      snapshot: source,
      sourceName: 'source.png',
      format: 'jpeg',
      suggestedName: 'source-edited.jpg',
      signal: controller.signal,
      onProgress,
    })).resolves.toMatchObject({ status: 'completed' })

    expect(mocks.prepare).toHaveBeenCalledWith(source.document, expect.objectContaining({
      width: 30,
      height: 20,
      bitDepth: 8,
    }))
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({
      document: source.document,
      resourceDescriptors: source.resources,
      signal: controller.signal,
      tileSize: 512,
      onTileRendered: expect.any(Function),
    }))
    const renderRequest = mocks.render.mock.calls[0][0]
    renderRequest.onTileRendered(3, 9)
    expect(onProgress).toHaveBeenCalledWith({ completed: 3, total: 9 })
    expect(mocks.exportRaster).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: source.documentRef,
      revision: source.revision,
      sourceFingerprint: source.sourceFingerprint,
      format: 'jpeg',
      tiles,
      suggestedName: 'source-edited.jpg',
      tileSize: 512,
    }), controller.signal)
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportRaster.mock.invocationCallOrder[0])
  })

  it('为 16-bit 与浮点 Rec.2020 PQ/HLG 文档开放 HDR AVIF 与线性 Float32 BigTIFF', async () => {
    const pq = snapshot(16)
    pq.document.color.workingSpace = 'rec2020'
    pq.document.color.iccProfileResourceId = null
    pq.document.color.transferFunction = 'pq'
    pq.document.color.hdrMetadata = createImageEditHdrMetadataV3('pq')
    expect(listImageMarkV3RasterExportFormats(pq.document)).toEqual(['avif10', 'avif12', 'bigtiff'])
    expect(createImageMarkV3RasterExportSpec(pq.document, 'hdr.tiff')).toEqual({
      format: 'avif10',
      suggestedName: 'hdr-edited.avif',
      description: {
        width: 30,
        height: 20,
        bitDepth: 16,
        sampleFormat: 'uint',
        colorSpace: 'rec2020',
        transferFunction: 'pq',
        alphaMode: 'straight',
        iccProfileResourceRef: null,
        cicp: {
          colorPrimaries: 9,
          transferCharacteristics: 16,
          matrixCoefficients: 9,
          fullRange: false,
        },
        hdrMetadata: null,
      },
    })

    for (const bitDepth of ['float16', 'float32'] as const) {
      const hlg = snapshot(16)
      hlg.document.color.workingSpace = 'rec2020'
      hlg.document.color.bitDepth = bitDepth
      hlg.document.color.iccProfileResourceId = null
      hlg.document.color.transferFunction = 'hlg'
      hlg.document.color.hdrMetadata = createImageEditHdrMetadataV3('hlg')
      expect(listImageMarkV3RasterExportFormats(hlg.document)).toEqual(['avif10', 'avif12', 'bigtiff'])
      expect(createImageMarkV3RasterExportSpec(hlg.document, 'hlg.tiff', {
        format: 'avif12',
      })).toMatchObject({
        format: 'avif12',
        description: {
          bitDepth: 16,
          sampleFormat: 'uint',
          colorSpace: 'rec2020',
          transferFunction: 'hlg',
          cicp: { transferCharacteristics: 18 },
        },
      })
    }

    expect(() => createImageMarkV3RasterExportSpec(pq.document, 'hdr.png', {
      format: 'png16',
    })).toThrow('imageEditor.v3.readiness.reasons.exportHdrMetadata')

    pq.document.color.hdrMetadata.contentLight = {
      maxContentLightLevelNits: 1_000,
      maxFrameAverageLightLevelNits: 400,
    }
    expect(listImageMarkV3RasterExportFormats(pq.document)).toEqual(['bigtiff'])
    expect(createImageMarkV3RasterExportSpec(pq.document, 'hdr.avif')).toMatchObject({
      format: 'bigtiff',
      suggestedName: 'hdr-edited.tif',
      description: {
        bitDepth: 32,
        sampleFormat: 'float',
        colorSpace: 'rec2020',
        transferFunction: 'linear',
        iccProfileResourceRef: null,
        cicp: null,
        hdrMetadata: null,
      },
    })
    expect(() => createImageMarkV3RasterExportSpec(pq.document, 'hdr.avif', {
      format: 'avif10',
    })).toThrow(
      'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    )

    const float = snapshot(16)
    float.document.color.bitDepth = 'float32'
    float.document.color.transferFunction = 'linear'
    expect(() => createImageMarkV3RasterExportSpec(float.document, 'float.tiff', {
      format: 'png16',
    })).toThrow(
      'imageEditor.v3.readiness.reasons.exportBitDepth',
    )
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.exportRaster).not.toHaveBeenCalled()
  })

  it('按最终裁剪尺寸在 900 万像素边界提供真实 HDR readiness', () => {
    const hdr = snapshot(16)
    hdr.document.color.workingSpace = 'rec2020'
    hdr.document.color.iccProfileResourceId = null
    hdr.document.color.transferFunction = 'pq'
    hdr.document.color.hdrMetadata = createImageEditHdrMetadataV3('pq')
    hdr.document.geometry = {
      width: 20_000,
      height: 10_000,
      orientation: { rotate: 0, mirrored: false },
      crop: { x: 0, y: 0, width: 3_000, height: 3_000 },
    }

    expect(IMAGE_EDITOR_V3_HDR_AVIF_MAX_PIXELS).toBe(9_000_000)
    expect(listImageMarkV3RasterExportFormats(hdr.document)).toEqual(['avif10', 'avif12', 'bigtiff'])
    expect(createImageMarkV3RasterExportSpec(hdr.document, '200mp.tif')).toMatchObject({
      format: 'avif10',
      description: { width: 3_000, height: 3_000 },
    })

    hdr.document.geometry.crop = { x: 0, y: 0, width: 3_001, height: 3_000 }
    expect(listImageMarkV3RasterExportFormats(hdr.document)).toEqual(['bigtiff'])
    expect(createImageMarkV3RasterExportSpec(hdr.document, '200mp.tif')).toMatchObject({
      format: 'bigtiff',
      description: { width: 3_001, height: 3_000, bitDepth: 32, transferFunction: 'linear' },
    })
    expect(resolveImageMarkV3RasterExportReadiness(
      hdr.document,
      '200mp.tif',
      'avif10',
    )).toEqual({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrPixelLimit',
    })
    expect(resolveImageMarkV3RasterExportReadiness(hdr.document, '200mp.tif')).toEqual({
      state: 'ready',
    })
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.exportRaster).not.toHaveBeenCalled()
  })

  it('用与真实导出相同的预检返回按钮就绪态与稳定原因键', () => {
    const supported = snapshot(8)
    expect(resolveImageMarkV3RasterExportReadiness(supported.document, 'source.png')).toEqual({
      state: 'ready',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(
      supported.document,
      expect.objectContaining({ bitDepth: 8 }),
    )

    mocks.prepare.mockImplementationOnce(() => {
      throw new Error('辉光 Pro 当前不能可靠导出 PNG')
    })
    expect(resolveImageMarkV3RasterExportReadiness(supported.document, 'source.png')).toEqual({
      state: 'disabled',
      reason: '辉光 Pro 当前不能可靠导出 PNG',
    })

    const hdr = snapshot(16)
    hdr.document.color.workingSpace = 'rec2020'
    hdr.document.color.iccProfileResourceId = null
    hdr.document.color.transferFunction = 'pq'
    hdr.document.color.hdrMetadata = createImageEditHdrMetadataV3('pq')
    expect(resolveImageMarkV3RasterExportReadiness(hdr.document, 'hdr.avif')).toEqual({
      state: 'ready',
    })

    hdr.document.color.hdrMetadata.contentLight = {
      maxContentLightLevelNits: 1_000,
      maxFrameAverageLightLevelNits: 400,
    }
    expect(resolveImageMarkV3RasterExportReadiness(
      hdr.document,
      'hdr.avif',
      'avif10',
    )).toMatchObject({
      state: 'disabled', reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
    expect(resolveImageMarkV3RasterExportReadiness(hdr.document, 'hdr.avif')).toEqual({
      state: 'ready',
    })

    const missingIcc = snapshot(16)
    missingIcc.document.color.iccProfileResourceId = null
    expect(resolveImageMarkV3RasterExportReadiness(
      missingIcc.document,
      'wide.tiff',
      'bigtiff',
    )).toMatchObject({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportInvalidIcc',
    })
  })
})
