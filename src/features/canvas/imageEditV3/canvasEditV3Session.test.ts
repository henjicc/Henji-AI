import { describe, expect, it, vi } from 'vitest'

import { createEmptyImageEditDocument, stringifyImageEditDocument } from '@/core/imageEdit'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedSource,
} from '@/platform/contracts/imageEditorV3'
import {
  CANVAS_EDIT_V3_SESSION_OPTION,
  CanvasEditV3SessionError,
  createCanvasEditV3SessionReference,
  prepareCanvasEditV3Session,
  readCanvasEditV3SessionOption,
  serializeCanvasEditV3SessionReference,
} from './canvasEditV3Session'

const SOURCE_REF = `sha256:${'a'.repeat(64)}` as const
const PREVIEW_REF = `sha256:${'b'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'c'.repeat(64)}` as const

function repository() {
  const save = vi.fn<
    Parameters<ImageEditDocumentRepositoryV3['save']>,
    ReturnType<ImageEditDocumentRepositoryV3['save']>
  >(async (document) => ({
    documentId: document.id,
    revision: document.revision,
    previewRef: null,
  }))
  return { save }
}

function managedSource(): ImageEditorV3ManagedSource {
  return {
    mediaUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`,
    resource: { resourceRef: SOURCE_REF, byteLength: 4_096, mediaType: 'image/png' },
    metadata: {
      resourceRef: SOURCE_REF,
      width: 2_000,
      height: 1_000,
      encodedWidth: 2_000,
      encodedHeight: 1_000,
      format: 'png',
      channels: 4,
      depth: 'uchar',
      bitsPerSample: 8,
      colorSpace: 'srgb',
      orientation: 1,
      orientationApplied: true,
      density: null,
      pages: 1,
      hasAlpha: true,
      hasIccProfile: false,
      iccProfileResourceRef: null,
      cicp: null,
      hdr: false,
    },
  }
}

function existingSnapshot(revision = 4): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({
    width: 640,
    height: 480,
    documentId: 'canvas-existing',
    sourceResourceId: SOURCE_REF,
    idFactory: (prefix) => `${prefix}-existing`,
  })
  document.revision = revision
  return {
    documentRef: 'image-edit-v3:canvas-existing',
    revision,
    previewRef: PREVIEW_REF,
    document,
    history: null,
    resourceRefs: [SOURCE_REF, PREVIEW_REF],
    resources: [
      { resourceRef: SOURCE_REF, byteLength: 4_096, mediaType: 'image/png' },
      { resourceRef: PREVIEW_REF, byteLength: 1_024, mediaType: 'image/png' },
    ],
    sourceFingerprint: FINGERPRINT,
  }
}

describe('画布图片编辑 V3 会话', () => {
  it('导入 V2 文档、迁移受管源并先保存唯一 V3 真相源', async () => {
    const repo = repository()
    const ingestSource = vi.fn(async () => managedSource())
    const prepared = await prepareCanvasEditV3Session({
      sourceImageUrl: '/source.png',
      toolOptions: {
        document: stringifyImageEditDocument(createEmptyImageEditDocument()),
      },
      documentId: 'canvas-imported',
      repository: repo,
      ingestSource,
    })

    expect(ingestSource).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'local-path', filePath: '/source.png' },
    }), undefined)
    expect(prepared.document).toMatchObject({
      id: 'canvas-imported',
      revision: 0,
      geometry: { width: 2_000, height: 1_000 },
    })
    expect(prepared.document.layers.map((layer) => layer.type)).toEqual(['raster'])
    expect(repo.save).toHaveBeenCalledOnce()
    expect(prepared.resourceByteSizes).toEqual({ [SOURCE_REF]: 4_096 })
    expect(prepared.resourceDescriptors).toEqual([managedSource().resource])
  })

  it('已有引用严格恢复同一 revision、preview 与资源描述，不重新导入源图', async () => {
    const repo = repository()
    const snapshot = existingSnapshot()
    const loadSnapshot = vi.fn(async () => snapshot)
    const ingestSource = vi.fn(async () => managedSource())
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'henji-media://source',
      documentRef: snapshot.documentRef,
      revision: snapshot.revision,
      previewRef: snapshot.previewRef,
    }

    const prepared = await prepareCanvasEditV3Session({
      sourceImageUrl: session.sourceUrl,
      toolOptions: {
        [CANVAS_EDIT_V3_SESSION_OPTION]: serializeCanvasEditV3SessionReference(session),
      },
      repository: repo,
      ingestSource,
      loadSnapshot,
    })

    expect(loadSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: session.documentRef,
    }), undefined)
    expect(ingestSource).not.toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
    expect(prepared.reference).toEqual({
      documentId: 'canvas-existing',
      revision: 4,
      previewRef: PREVIEW_REF,
    })
    expect(prepared.resourceByteSizes).toEqual({
      [SOURCE_REF]: 4_096,
      [PREVIEW_REF]: 1_024,
    })
    expect(prepared.resourceDescriptors).toEqual(snapshot.resources)
  })

  it('来源或权威版本不一致时明确失败，绝不迁移成新文档回退', async () => {
    const session = createCanvasEditV3SessionReference('source-a.png', {
      documentId: 'canvas-existing',
      revision: 4,
      previewRef: PREVIEW_REF,
    })
    const encoded = serializeCanvasEditV3SessionReference(session)

    expect(() => readCanvasEditV3SessionOption({
      [CANVAS_EDIT_V3_SESSION_OPTION]: encoded,
    }, 'source-b.png')).toThrow(CanvasEditV3SessionError)
    expect(() => readCanvasEditV3SessionOption({
      [CANVAS_EDIT_V3_SESSION_OPTION]: JSON.stringify({
        kind: 'image-edit-v3',
        documentRef: 'image-edit-v3:canvas-existing',
        revision: 4,
        previewRef: PREVIEW_REF,
      }),
    }, 'source-a.png')).toThrow(CanvasEditV3SessionError)

    const repo = repository()
    const loadSnapshot = vi.fn(async () => existingSnapshot(5))
    await expect(prepareCanvasEditV3Session({
      sourceImageUrl: session.sourceUrl,
      toolOptions: { [CANVAS_EDIT_V3_SESSION_OPTION]: encoded },
      repository: repo,
      loadSnapshot,
    })).rejects.toThrow('版本与权威文档不一致')
    expect(repo.save).not.toHaveBeenCalled()
  })
})
