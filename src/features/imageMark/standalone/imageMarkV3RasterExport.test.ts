import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'
import {
  createImageMarkV3RasterExportSpec,
  exportImageMarkV3Raster,
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
    renderImageEditorV3ExportTiles: mocks.render,
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
      'photo-edited.png',
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

  it('用同一个取消信号串联预检、分块渲染与原子输出命令', async () => {
    const source = snapshot(8)
    const controller = new AbortController()
    const onProgress = vi.fn()

    await expect(exportImageMarkV3Raster({
      snapshot: source,
      sourceName: 'source.png',
      suggestedName: 'source-edited.png',
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
      format: 'png8',
      tiles,
      suggestedName: 'source-edited.png',
      tileSize: 512,
    }), controller.signal)
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.exportRaster.mock.invocationCallOrder[0])
  })

  it('HDR 与浮点文档明确阻断且不会启动输出会话', async () => {
    const hdr = snapshot(16)
    hdr.document.color.transferFunction = 'pq'
    hdr.document.color.hdrMetadata = { standard: 'pq' }
    expect(() => createImageMarkV3RasterExportSpec(hdr.document, 'hdr.avif')).toThrow(
      'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    )

    const float = snapshot(16)
    float.document.color.bitDepth = 'float16'
    expect(() => createImageMarkV3RasterExportSpec(float.document, 'float.tiff')).toThrow(
      'imageEditor.v3.readiness.reasons.exportBitDepth',
    )
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
    hdr.document.color.transferFunction = 'pq'
    hdr.document.color.hdrMetadata = { standard: 'pq' }
    expect(resolveImageMarkV3RasterExportReadiness(hdr.document, 'hdr.avif')).toMatchObject({
      state: 'disabled',
      reasonKey: 'imageEditor.v3.readiness.reasons.exportHdrMetadata',
    })
  })
})
