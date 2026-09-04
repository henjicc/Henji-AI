import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'
import { materializeCanvasEditV3Snapshot } from './canvasEditV3Materialization'

const SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const PREVIEW_REF = `sha256:${'b'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'c'.repeat(64)}` as const
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
    documentId: 'canvas-document',
    sourceResourceId: SOURCE_REF,
    idFactory: (prefix) => `${prefix}-canvas`,
  })
  document.revision = 3
  return {
    documentRef: 'image-edit-v3:canvas-document',
    revision: 3,
    previewRef: null,
    document,
    history: null,
    resourceRefs: [SOURCE_REF],
    resources: [{ resourceRef: SOURCE_REF, byteLength: 128, mediaType: 'image/png' }],
    sourceFingerprint: FINGERPRINT,
  }
}

describe('画布图片编辑 V3 受管物化', () => {
  beforeEach(() => {
    mocks.prepare.mockReset().mockReturnValue({
      document: snapshot().document,
      plan: { nodes: [], diagnostics: [] },
    })
    mocks.render.mockReset().mockReturnValue(tiles)
    mocks.materialize.mockReset().mockResolvedValue({
      outputRef: 'image-export-v3:canvas-document@3:png8',
      documentRef: 'image-edit-v3:canvas-document',
      revision: 3,
      sourceFingerprint: FINGERPRINT,
      format: 'png8',
      width: 96,
      height: 64,
      previewRef: PREVIEW_REF,
      mediaUrl: `henji-media://image-editor-v3/${'b'.repeat(64)}?mediaType=image%2Fpng`,
    })
  })

  it('复用 512 分块渲染并返回可恢复会话，不创建完整 Canvas 或 Data URL', async () => {
    const source = snapshot()
    const controller = new AbortController()
    const result = await materializeCanvasEditV3Snapshot(
      source,
      'source.png',
      controller.signal,
    )

    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({
      document: source.document,
      resourceDescriptors: source.resources,
      tileSize: 512,
      signal: controller.signal,
    }))
    expect(mocks.materialize).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: source.documentRef,
      revision: source.revision,
      sourceFingerprint: source.sourceFingerprint,
      tiles,
      tileSize: 512,
    }), controller.signal)
    expect(result.raster.mediaUrl).toMatch(/^henji-media:\/\/image-editor-v3\//)
    expect(result.raster.mediaUrl).not.toMatch(/^data:/)
    expect(result.session).toEqual({
      kind: 'image-edit-v3',
      sourceUrl: result.raster.mediaUrl,
      documentRef: source.documentRef,
      revision: 3,
      previewRef: PREVIEW_REF,
    })
  })

  it('取消在任何输出会话创建前生效', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(materializeCanvasEditV3Snapshot(
      snapshot(),
      'source.png',
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it('拒绝主进程返回的 revision 或指纹漂移', async () => {
    mocks.materialize.mockResolvedValueOnce({
      outputRef: 'image-export-v3:canvas-document@4:png8',
      documentRef: 'image-edit-v3:canvas-document',
      revision: 4,
      sourceFingerprint: FINGERPRINT,
      format: 'png8',
      width: 96,
      height: 64,
      previewRef: PREVIEW_REF,
      mediaUrl: 'henji-media://image-editor-v3/stale',
    })

    await expect(materializeCanvasEditV3Snapshot(
      snapshot(),
      'source.png',
    )).rejects.toThrow('版本不一致')
  })

  it('拒绝主进程返回与权威渲染计划不一致的尺寸或格式', async () => {
    mocks.materialize.mockResolvedValueOnce({
      outputRef: 'image-export-v3:canvas-document@3:png8',
      documentRef: 'image-edit-v3:canvas-document',
      revision: 3,
      sourceFingerprint: FINGERPRINT,
      format: 'png8',
      width: 95,
      height: 64,
      previewRef: PREVIEW_REF,
      mediaUrl: 'henji-media://image-editor-v3/invalid-size',
    })

    await expect(materializeCanvasEditV3Snapshot(
      snapshot(),
      'source.png',
    )).rejects.toThrow('尺寸或格式')
  })
})
