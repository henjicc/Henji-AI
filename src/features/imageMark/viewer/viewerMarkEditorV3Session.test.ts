import { describe, expect, it, vi } from 'vitest'

import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3ManagedSource,
  ImageEditorV3SourceMetadata,
} from '@/platform/contracts/imageEditorV3'
import {
  createViewerMarkEditorV3SessionReference,
  prepareViewerMarkEditorV3Session,
} from './viewerMarkEditorV3Session'

const RESOURCE_REF = `sha256:${'a'.repeat(64)}` as const

function sourceMetadata(overrides: Partial<ImageEditorV3SourceMetadata> = {}): ImageEditorV3SourceMetadata {
  return {
    resourceRef: RESOURCE_REF,
    width: 1200,
    height: 800,
    encodedWidth: 1200,
    encodedHeight: 800,
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
    ...overrides,
  }
}

function managedSource(metadata = sourceMetadata()): ImageEditorV3ManagedSource {
  return {
    mediaUrl: `henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`,
    resource: { resourceRef: RESOURCE_REF, byteLength: 4096, mediaType: 'image/png' },
    metadata,
  }
}

function repository() {
  const load = vi.fn<
    Parameters<ImageEditDocumentRepositoryV3['load']>,
    ReturnType<ImageEditDocumentRepositoryV3['load']>
  >(async () => null)
  const save = vi.fn<
    Parameters<ImageEditDocumentRepositoryV3['save']>,
    ReturnType<ImageEditDocumentRepositoryV3['save']>
  >(async (document) => ({
      documentId: document.id,
      revision: document.revision,
      previewRef: null,
  }))
  return { load, save }
}

describe('查看器快速编辑 V3 会话准备', () => {
  it('把旧查看器会话导入受管资源、迁移成 V3 并先持久化再交给编辑器', async () => {
    const repo = repository()
    const ingestSource = vi.fn(async () => managedSource())
    const prepared = await prepareViewerMarkEditorV3Session({
      imageUrl: 'display.png',
      session: {
        sourceUrl: '/original.png',
        document: createEmptyImageEditDocument(),
      },
      documentId: 'viewer-document',
      repository: repo,
      ingestSource,
    })

    expect(ingestSource).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'local-path', filePath: '/original.png' },
    }), undefined)
    expect(prepared.document).toMatchObject({
      version: 3,
      id: 'viewer-document',
      geometry: { width: 1200, height: 800 },
    })
    expect(prepared.document.layers.map((layer) => layer.type)).toEqual(['raster'])
    expect(repo.save).toHaveBeenCalledOnce()
    expect(prepared.reference).toEqual({
      documentId: 'viewer-document',
      revision: 0,
      previewRef: null,
    })
    expect(prepared.resourceDescriptors).toEqual([managedSource().resource])
  })

  it('已有 V3 会话从权威快照恢复文档和 resource descriptors，不重新导入源图', async () => {
    const document = createImageEditDocumentV3({
      width: 640,
      height: 480,
      documentId: 'viewer-existing',
    })
    const repo = repository()
    const loadSnapshot = vi.fn(async () => ({
      documentRef: 'image-edit-v3:viewer-existing',
      revision: 4,
      previewRef: RESOURCE_REF,
      document: { ...document, revision: 4 },
      history: null,
      resourceRefs: [RESOURCE_REF],
      resources: [managedSource().resource],
      sourceFingerprint: `sha256:${'b'.repeat(64)}`,
    } as ImageEditorV3DocumentSnapshot))
    const ingestSource = vi.fn(async () => managedSource())

    const prepared = await prepareViewerMarkEditorV3Session({
      imageUrl: 'display.png',
      session: {
        kind: 'image-edit-v3',
        sourceUrl: 'original.png',
        documentRef: 'image-edit-v3:viewer-existing',
        revision: 3,
        previewRef: null,
      },
      documentId: 'unused-document',
      repository: repo,
      ingestSource,
      loadSnapshot,
    })

    expect(loadSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: 'image-edit-v3:viewer-existing',
    }), undefined)
    expect(repo.save).not.toHaveBeenCalled()
    expect(ingestSource).not.toHaveBeenCalled()
    expect(prepared.reference).toEqual({
      documentId: 'viewer-existing',
      revision: 4,
      previewRef: RESOURCE_REF,
    })
    expect(prepared.resourceDescriptors).toEqual([managedSource().resource])
    expect(createViewerMarkEditorV3SessionReference(
      prepared.sourceUrl,
      prepared.reference,
    )).toEqual({
      kind: 'image-edit-v3',
      sourceUrl: 'original.png',
      documentRef: 'image-edit-v3:viewer-existing',
      revision: 4,
      previewRef: RESOURCE_REF,
    })
  })

  it('quick profile 拒绝 HDR，且不会在失败后静默保存或回退旧编辑器', async () => {
    const repo = repository()
    const ingestSource = vi.fn(async () => managedSource(sourceMetadata({
      hdr: true,
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics: 16,
        matrixCoefficients: 9,
        fullRange: false,
      },
    })))

    await expect(prepareViewerMarkEditorV3Session({
      imageUrl: '/hdr.png',
      documentId: 'viewer-hdr',
      repository: repo,
      ingestSource,
    })).rejects.toMatchObject({
      readiness: {
        state: 'disabled',
        reasonKey: 'imageEditor.v3.readiness.reasons.quickHdr',
      },
    })
    expect(repo.save).not.toHaveBeenCalled()
  })
})
