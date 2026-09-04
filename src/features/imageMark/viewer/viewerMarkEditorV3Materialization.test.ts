import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'
import {
  materializeViewerMarkV3Raster,
  resolveViewerMarkV3MaterializationReadiness,
} from './viewerMarkEditorV3Materialization'

const SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'b'.repeat(64)}` as const
const PREVIEW_REF = `sha256:${'c'.repeat(64)}` as const
const tiles = {
  async *[Symbol.asyncIterator]() {
    yield { x: 0, y: 0, width: 1, height: 1, rowStride: 4, pixels: new Uint8Array(4) }
  },
}

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  render: vi.fn(),
  materialize: vi.fn(),
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
  materializeImageEditorV3Raster: mocks.materialize,
}))

function snapshot(): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({
    width: 96,
    height: 64,
    documentId: 'viewer-document',
    sourceResourceId: SOURCE_REF,
    idFactory: (prefix) => `${prefix}-viewer`,
  })
  document.revision = 3
  return {
    documentRef: 'image-edit-v3:viewer-document',
    revision: 3,
    previewRef: null,
    document,
    history: null,
    resourceRefs: [SOURCE_REF],
    resources: [{ resourceRef: SOURCE_REF, byteLength: 128, mediaType: 'image/png' }],
    sourceFingerprint: FINGERPRINT,
  }
}

describe('查看器快速编辑 V3 受管物化', () => {
  beforeEach(() => {
    mocks.prepare.mockReset().mockReturnValue({
      document: snapshot().document,
      plan: { nodes: [], diagnostics: [] },
    })
    mocks.render.mockReset().mockReturnValue(tiles)
    mocks.materialize.mockReset().mockResolvedValue({
      outputRef: 'image-export-v3:viewer-document@3:png8',
      documentRef: 'image-edit-v3:viewer-document',
      revision: 3,
      sourceFingerprint: FINGERPRINT,
      format: 'png8',
      width: 96,
      height: 64,
      previewRef: PREVIEW_REF,
      mediaUrl: `henji-media://image-editor-v3/${'c'.repeat(64)}?mediaType=image%2Fpng`,
    })
  })

  it('只把权威快照逐瓦片送入受管输出，不构造完整像素或 Data URL', async () => {
    const source = snapshot()
    const controller = new AbortController()
    const onProgress = vi.fn()

    const result = await materializeViewerMarkV3Raster({
      snapshot: source,
      sourceName: 'source.png',
      signal: controller.signal,
      onProgress,
    })

    expect(mocks.prepare).toHaveBeenCalledWith(source.document, expect.objectContaining({
      width: 96,
      height: 64,
      bitDepth: 8,
    }))
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({
      document: source.document,
      resourceDescriptors: source.resources,
      tileSize: 512,
      signal: controller.signal,
    }))
    const renderRequest = mocks.render.mock.calls[0][0]
    renderRequest.onTileRendered(2, 5)
    expect(onProgress).toHaveBeenCalledWith({ completed: 2, total: 5 })
    expect(mocks.materialize).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: source.documentRef,
      revision: source.revision,
      sourceFingerprint: source.sourceFingerprint,
      tiles,
      tileSize: 512,
    }), controller.signal)
    expect(mocks.materialize.mock.calls[0][0]).not.toHaveProperty('suggestedName')
    expect(result).toMatchObject({ previewRef: PREVIEW_REF })
    expect(result.mediaUrl).toMatch(/^henji-media:\/\/image-editor-v3\//)
    expect(result.mediaUrl).not.toMatch(/^data:/)
  })

  it('拒绝与权威快照版本不一致的受管结果', async () => {
    mocks.materialize.mockResolvedValueOnce({
      outputRef: 'image-export-v3:viewer-document@4:png8',
      documentRef: 'image-edit-v3:viewer-document',
      revision: 4,
      sourceFingerprint: FINGERPRINT,
      format: 'png8',
      width: 96,
      height: 64,
      previewRef: PREVIEW_REF,
      mediaUrl: 'henji-media://image-editor-v3/stale',
    })

    await expect(materializeViewerMarkV3Raster({
      snapshot: snapshot(),
      sourceName: 'source.png',
      signal: new AbortController().signal,
    })).rejects.toThrow('版本不一致')
  })

  it('共享分块渲染预检失败时给替换按钮返回同一精确原因', () => {
    mocks.prepare.mockImplementationOnce(() => {
      throw new Error('画笔瓦片读取桥接完成前不能导出')
    })

    expect(resolveViewerMarkV3MaterializationReadiness(
      snapshot().document,
      'source.png',
    )).toEqual({
      state: 'disabled',
      reason: '画笔瓦片读取桥接完成前不能导出',
    })
  })
})
