import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getImageEditOperation,
  IMAGE_EDIT_OPERATION_IDS,
  imageEditDocumentToMarkDoc,
  parseImageEditDocument,
  type DiffusionOperationParams,
  type VgpuGlowOperationParams,
} from '@/core/imageEdit'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { createImageEditPreviewFromRef } from '@/features/assistant/applicationCapabilities/generationCapabilities'

const dependencies = vi.hoisted(() => ({
  readImageInfo: vi.fn(),
  persistImageSource: vi.fn(),
  exportImageEditDocument: vi.fn(),
  addMediaReferenceToLibrary: vi.fn(),
}))

vi.mock('@/commands/image', () => ({
  readImageInfo: dependencies.readImageInfo,
  persistImageSource: dependencies.persistImageSource,
}))
vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({
  exportImageEditDocument: dependencies.exportImageEditDocument,
}))
vi.mock('@/features/assets/services/assetCollectionService', () => ({
  addMediaReferenceToLibrary: dependencies.addMediaReferenceToLibrary,
}))

import {
  commitImageEdit,
  createImageEditPreview,
  resetImageEditApplicationStateForTests,
} from './imageEditApplicationService'
import { createImageEditReflectionRegistrations, IMAGE_EDIT_ENTITY_TYPES } from './imageEditReflection'
import { getStoredImageEditPreview } from './imageEditSessionRegistry'

describe('image edit application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImageEditApplicationStateForTests()
    dependencies.readImageInfo.mockResolvedValue({ width: 800, height: 600 })
    dependencies.exportImageEditDocument.mockResolvedValue('data:image/png;base64,edited')
    dependencies.persistImageSource.mockResolvedValue('C:\\managed\\edited.png')
    dependencies.addMediaReferenceToLibrary.mockResolvedValue({ id: 'asset-edited' })
  })

  it('创建预览后，返回的 image_edit.preview 稳定引用可通过通用 list/read 读取', async () => {
    const preview = await createImageEditPreview({
      sourceRef: 'asset:source:1',
      source: 'henji-media://local/source-1',
      operations: [{ kind: 'rotate_cw', degrees: 90 }],
    })
    const registrations = createImageEditReflectionRegistrations()
    expect(registrations.map((item) => item.entity.id)).toEqual([
      IMAGE_EDIT_ENTITY_TYPES.preview,
      IMAGE_EDIT_ENTITY_TYPES.document,
      IMAGE_EDIT_ENTITY_TYPES.layer,
      IMAGE_EDIT_ENTITY_TYPES.group,
      IMAGE_EDIT_ENTITY_TYPES.mask,
      IMAGE_EDIT_ENTITY_TYPES.resource,
    ])
    const previewRegistration = registrations.find((item) => (
      item.entity.id === IMAGE_EDIT_ENTITY_TYPES.preview
    ))
    if (!previewRegistration?.provider) throw new Error('IMAGE_EDIT_PREVIEW_PROVIDER_MISSING')
    const previewRef = { kind: IMAGE_EDIT_ENTITY_TYPES.preview, id: String(preview.previewRef) }
    await expect(previewRegistration.provider.listEntities({ limit: 20 })).resolves.toMatchObject({
      refs: [previewRef],
    })
    await expect(previewRegistration.provider.readEntity(previewRef, {})).resolves.toMatchObject({
      ref: previewRef,
      properties: {
        'image_edit.preview.source_ref': { kind: 'asset', id: 'source:1' },
        'image_edit.preview.document_ref': {
          kind: IMAGE_EDIT_ENTITY_TYPES.document,
          id: preview.previewRef,
        },
        'image_edit.preview.width': 800,
        'image_edit.preview.height': 600,
      },
    })
    const document = registrations.find((item) => item.entity.id === IMAGE_EDIT_ENTITY_TYPES.document)
    if (!document?.provider) throw new Error('IMAGE_EDIT_DOCUMENT_PROVIDER_MISSING')
    const snapshot = await document.provider.readEntity(
      { kind: IMAGE_EDIT_ENTITY_TYPES.document, id: String(preview.previewRef) },
      {},
    )
    expect(snapshot?.properties['image_edit.document.preview_ref']).toEqual(previewRef)
    expect(snapshot?.properties['image_edit.document.layer_refs']).toHaveLength(3)
  })

  it('继续编辑旧预览时保留旧层并让新启用的互斥光效获胜', async () => {
    const firstPreview = await createImageEditPreview({
      sourceRef: 'generation.result:source-1',
      source: 'henji-media://local/source-1',
      operations: [
        {
          kind: 'mark',
          item: {
            id: 'existing-mark',
            type: 'rect',
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            stroke: ANNOTATION_DEFAULT_STROKE_HEX,
            lineWidth: 2,
          },
        },
        { kind: 'diffusion', mode: 'white_mist', density: 'medium' },
      ],
    })
    const existingDocument = parseImageEditDocument(firstPreview.document)

    const result = await createImageEditPreviewFromRef({
      sourceRef: {
        kind: 'image_edit.preview',
        id: String(firstPreview.previewRef),
      },
      operations: [{ kind: 'vgpu_glow', look: 'neon' }],
    })
    const continuedPreview = getStoredImageEditPreview(String(result.previewRef))
    if (!continuedPreview) throw new Error('CONTINUED_PREVIEW_NOT_STORED')
    const continuedDocument = parseImageEditDocument(continuedPreview.document)

    expect(imageEditDocumentToMarkDoc(continuedDocument).items).toEqual([
      expect.objectContaining({ id: 'existing-mark', type: 'rect' }),
    ])
    expect(getImageEditOperation<DiffusionOperationParams>(
      continuedDocument,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
    )).toMatchObject({
      id: getImageEditOperation(existingDocument, IMAGE_EDIT_OPERATION_IDS.diffusion)?.id,
      enabled: false,
      params: { mode: 'white_mist', density: 'medium' },
    })
    expect(getImageEditOperation<VgpuGlowOperationParams>(
      continuedDocument,
      IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
    )).toMatchObject({
      enabled: true,
      params: { look: 'neon' },
    })
  })

  it('提交失败保留预览，成功后才结束会话并生成新素材', async () => {
    const preview = await createImageEditPreview({
      sourceRef: 'asset:source-1',
      source: 'henji-media://local/source-1',
      operations: [{ kind: 'flip_h' }],
    })
    dependencies.persistImageSource.mockRejectedValueOnce(new Error('WRITE_FAILED'))
    await expect(commitImageEdit(String(preview.previewRef))).rejects.toThrow('WRITE_FAILED')

    await expect(commitImageEdit(String(preview.previewRef), '编辑结果')).resolves.toEqual({
      previewRef: preview.previewRef,
      assetId: 'asset-edited',
      status: 'committed',
    })
    await expect(commitImageEdit(String(preview.previewRef))).rejects.toThrow('NOT_FOUND')
  })
})
