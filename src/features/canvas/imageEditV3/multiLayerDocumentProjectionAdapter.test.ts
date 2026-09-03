import { describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'

import { createMultiLayerDocumentProjectionPort } from './multiLayerDocumentProjectionAdapter'
import { CanvasEditV3MaterializationContractError } from './canvasEditV3Materialization'

const SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const OLD_PREVIEW_REF = `sha256:${'b'.repeat(64)}` as const
const NEW_PREVIEW_REF = `sha256:${'c'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'d'.repeat(64)}` as const

function snapshot(
  previewRef: ImageEditorV3ResourceRef | null = OLD_PREVIEW_REF,
): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({
    width: 120,
    height: 80,
    documentId: 'projection-document',
    sourceResourceId: SOURCE_REF,
    idFactory: (prefix) => `${prefix}-projection`,
  })
  document.revision = 4
  return {
    documentRef: 'image-edit-v3:projection-document',
    revision: 4,
    previewRef,
    document,
    history: null,
    resourceRefs: [SOURCE_REF, ...(previewRef ? [previewRef] : [])],
    resources: [{ resourceRef: SOURCE_REF, byteLength: 4, mediaType: 'image/png' }],
    sourceFingerprint: FINGERPRINT,
  }
}

const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: '/managed/old-composite.png',
  documentRef: 'image-edit-v3:projection-document' as const,
  revision: 4,
  previewRef: OLD_PREVIEW_REF,
}

function materialized() {
  const mediaUrl = `henji-media://image-editor-v3/${'c'.repeat(64)}?mediaType=image%2Fpng`
  return {
    raster: {
      outputRef: 'image-export-v3:projection-document@4:png8' as const,
      documentRef: session.documentRef,
      revision: 4,
      sourceFingerprint: FINGERPRINT,
      format: 'png8' as const,
      width: 120,
      height: 80,
      publication: 'document-preview' as const,
      previewRef: NEW_PREVIEW_REF,
      mediaUrl,
    },
    session: {
      kind: 'image-edit-v3' as const,
      sourceUrl: mediaUrl,
      documentRef: session.documentRef,
      revision: 4,
      previewRef: NEW_PREVIEW_REF,
    },
  }
}

describe('多图层文档整图物化适配器', () => {
  it('加载 flush 后精确 revision 并返回可补偿的同版本投影', async () => {
    const loadDocument = vi.fn(async () => snapshot())
    const materialize = vi.fn(async () => materialized())
    const port = createMultiLayerDocumentProjectionPort({ loadDocument, materialize })

    const result = await port.saveAndMaterialize({ session })

    expect(loadDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: session.documentRef,
    }), undefined)
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), '多图层图片文档', undefined)
    expect(result.projection).toMatchObject({
      imageUrl: materialized().raster.mediaUrl,
      previewImageUrl: materialized().raster.mediaUrl,
      aspectRatio: '3:2',
      imageEditSession: { revision: 4, previewRef: NEW_PREVIEW_REF },
    })
    expect(result.rollback).toMatchObject({
      previousPreviewRef: OLD_PREVIEW_REF,
      installedPreviewRef: NEW_PREVIEW_REF,
      sourceFingerprint: FINGERPRINT,
    })
  })

  it('CAS 未接管时只在 revision、指纹和 installed previewRef 全匹配时恢复并回收', async () => {
    const loadDocument = vi.fn(async () => snapshot())
    const materialize = vi.fn(async () => materialized())
    const restorePreview = vi.fn(async () => undefined)
    const collectGarbage = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentProjectionPort({
      loadDocument,
      materialize,
      restorePreview,
      collectGarbage,
    })
    const prepared = await port.saveAndMaterialize({ session })
    loadDocument.mockResolvedValueOnce(snapshot(NEW_PREVIEW_REF))

    await expect(port.rollbackMaterialization({ materialization: prepared })).resolves.toBe(true)
    expect(restorePreview).toHaveBeenCalledWith(
      expect.objectContaining({ previewRef: NEW_PREVIEW_REF }),
      OLD_PREVIEW_REF,
    )
    expect(collectGarbage).toHaveBeenCalledWith(
      'projection-document',
      expect.not.arrayContaining([NEW_PREVIEW_REF]),
    )
  })

  it('文档 revision 或 previewRef 已变化时拒绝回滚其他操作的结果', async () => {
    const loadDocument = vi.fn(async () => snapshot())
    const materialize = vi.fn(async () => materialized())
    const restorePreview = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentProjectionPort({ loadDocument, materialize, restorePreview })
    const prepared = await port.saveAndMaterialize({ session })
    loadDocument.mockResolvedValueOnce(snapshot(`sha256:${'e'.repeat(64)}`))

    await expect(port.rollbackMaterialization({ materialization: prepared })).resolves.toBe(false)
    expect(restorePreview).not.toHaveBeenCalled()
  })

  it('CAS 接管后重写资源集合并回收被替换的旧 previewRef', async () => {
    const loadDocument = vi.fn(async () => snapshot())
    const materialize = vi.fn(async () => materialized())
    const restorePreview = vi.fn(async () => undefined)
    const collectGarbage = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentProjectionPort({
      loadDocument,
      materialize,
      restorePreview,
      collectGarbage,
    })
    const prepared = await port.saveAndMaterialize({ session })
    const installed = snapshot(NEW_PREVIEW_REF)
    installed.resourceRefs = [SOURCE_REF, OLD_PREVIEW_REF, NEW_PREVIEW_REF]
    loadDocument.mockResolvedValueOnce(installed)

    await expect(port.finalizeMaterialization({ materialization: prepared })).resolves.toBe(true)
    expect(restorePreview).toHaveBeenCalledWith(installed, NEW_PREVIEW_REF)
    expect(collectGarbage).toHaveBeenCalledWith(
      'projection-document',
      [SOURCE_REF, NEW_PREVIEW_REF],
    )
  })

  it('精确 revision 不存在或已推进时不创建物化会话', async () => {
    const changed = snapshot()
    changed.revision = 5
    changed.document.revision = 5
    const materialize = vi.fn(async () => materialized())
    const port = createMultiLayerDocumentProjectionPort({
      loadDocument: vi.fn(async () => changed),
      materialize,
    })

    await expect(port.saveAndMaterialize({ session })).rejects.toMatchObject({
      code: 'DOCUMENT_CONFLICT',
      recoverable: true,
    })
    expect(materialize).not.toHaveBeenCalled()
  })

  it('物化已挂载 previewRef 后发现契约无效时补偿恢复旧预览', async () => {
    const loadDocument = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(NEW_PREVIEW_REF))
    const invalidResult = materialized()
    invalidResult.raster.width = 119
    const materialize = vi.fn(async () => {
      throw new CanvasEditV3MaterializationContractError('尺寸不一致', invalidResult)
    })
    const restorePreview = vi.fn(async () => undefined)
    const collectGarbage = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentProjectionPort({
      loadDocument,
      materialize,
      restorePreview,
      collectGarbage,
    })

    await expect(port.saveAndMaterialize({ session })).rejects.toThrow('尺寸不一致')
    expect(restorePreview).toHaveBeenCalledWith(
      expect.objectContaining({ previewRef: NEW_PREVIEW_REF }),
      OLD_PREVIEW_REF,
    )
  })
})
