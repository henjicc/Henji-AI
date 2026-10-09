// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseImageEditDocumentV3 } from '@/core/imageEdit/v3/documentCodec'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { createImageEditPreviewFromRef } from './imageSourceCapabilityService'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, readHarnessImageEditDocument } from '@/tests/harnessNativeStorage'
import { imageEditTestManagedSource, imageEditTestSnapshot } from '@/tests/imageEditV3SourceFixture'
const dependencies = vi.hoisted(() => ({ ingest: vi.fn(), materialize: vi.fn(), persist: vi.fn(), addMediaReferenceToLibrary: vi.fn(), inspectAsset: vi.fn() }))
vi.mock('@/commands/imageEditorV3', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/imageEditorV3')>(),
  ingestImageEditorV3Source: dependencies.ingest,
  loadImageEditorV3Document: async (request: { documentRef: string }) => { const stored = readHarnessImageEditDocument(request.documentRef.slice('image-edit-v3:'.length)); return stored ? imageEditTestSnapshot(stored.document) : null },
}))
vi.mock('@/commands/image', () => ({ persistImageSource: dependencies.persist }))
vi.mock('../v3/application/imageEditMaterializationV3', () => ({ materializeImageEditSnapshotV3: dependencies.materialize }))
vi.mock('@/features/assets/services/assetCollectionService', () => ({ addMediaReferenceToLibrary: dependencies.addMediaReferenceToLibrary }))
vi.mock('@/commands/assetLibrary', () => ({ inspectAsset: dependencies.inspectAsset }))
import { commitImageEdit, createImageEditPreview, resetImageEditApplicationStateForTests } from './imageEditApplicationService'
import { createImageEditReflectionRegistrations, IMAGE_EDIT_ENTITY_TYPES } from './imageEditReflection'
import { getStoredImageEditPreview } from './imageEditSessionRegistry'
import { resolveGenerationMediaReferences } from '@/features/generation/application/generationMediaReferences'
import { materializeImageEditPreview } from './imageEditApplicationService'
import { resetImageEditDocumentInstancesForTestsV3 } from '../v3/application/imageEditDocumentInstances'
import { requireImageEditPersistenceOwnerV3 } from '../v3/application/imageEditPersistenceOperations'

describe('image edit application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImageEditApplicationStateForTests()
    resetImageEditDocumentInstancesForTestsV3()
    installHarnessNativeStorage()
    dependencies.ingest.mockReset().mockResolvedValue(imageEditTestManagedSource())
    dependencies.persist.mockResolvedValue('C:\\managed\\edited.png')
    dependencies.materialize.mockResolvedValue({ raster: { mediaUrl: 'C:\\managed\\edited.png' } })
    dependencies.addMediaReferenceToLibrary.mockResolvedValue({ id: 'asset-edited', filePath: 'C:\\managed\\edited.png' })
    dependencies.inspectAsset.mockResolvedValue({ id: 'asset-edited', filePath: 'C:\\managed\\edited.png', mediaType: 'image', inspectionStatus: 'ready' })
  })

  afterEach(uninstallHarnessNativeStorage)

  it('编辑后直接作为生成参考，实际合成编辑步骤且不收藏、不删除预览', async () => {
    const result = await createImageEditPreview({ sourceRef: 'generation.result:previous', source: '/original.png', operations: [{ kind: 'rotate_cw', degrees: 90 }] })
    const previewRef = String(result.previewRef)
    const input = { uploadedImages: [{ kind: 'image_edit.preview', id: previewRef }] }
    const [prepared, submitted] = await Promise.all([resolveGenerationMediaReferences(input), resolveGenerationMediaReferences(input)])
    expect(prepared.uploadedFilePaths).toEqual(['C:\\managed\\edited.png'])
    expect(submitted).toEqual(prepared)
    expect(dependencies.materialize).toHaveBeenCalledTimes(1)
    expect(dependencies.materialize.mock.calls[0][0].document).toEqual(getStoredImageEditPreview(previewRef)!.document)
    expect(dependencies.addMediaReferenceToLibrary).not.toHaveBeenCalled()
    expect(getStoredImageEditPreview(previewRef)).not.toBeNull()
    await commitImageEdit(previewRef)
    expect(dependencies.materialize).toHaveBeenCalledTimes(1)
    expect(dependencies.addMediaReferenceToLibrary).toHaveBeenCalledTimes(1)
  })

  it('编辑预览变更后重新合成，失败不缓存为成功且不回退原图', async () => {
    const result = await createImageEditPreview({ sourceRef: 'asset:source', source: '/original.png', operations: [{ kind: 'rotate_cw', degrees: 90 }] })
    const ref = String(result.previewRef)
    dependencies.materialize.mockRejectedValueOnce(new Error('合成失败'))
    await expect(materializeImageEditPreview(ref)).rejects.toThrow('合成失败')
    expect(dependencies.addMediaReferenceToLibrary).not.toHaveBeenCalled()
    await materializeImageEditPreview(ref)
    getStoredImageEditPreview(ref)!.source = '/replacement.png'
    await materializeImageEditPreview(ref)
    expect(dependencies.materialize).toHaveBeenCalledTimes(3)
    expect(dependencies.materialize.mock.calls[2][0].document).toEqual(getStoredImageEditPreview(ref)!.document)
  })

  it('编辑预览失效或作为音视频输入时拒绝，不偷偷用原图继续生成', async () => {
    await expect(resolveGenerationMediaReferences({ uploadedImages: [{ kind: 'image_edit.preview', id: 'missing' }] })).rejects.toThrow('预览已失效')
    await expect(resolveGenerationMediaReferences({ uploadedVideos: [{ kind: 'image_edit.preview', id: 'missing' }] })).rejects.toThrow('实际为 image')
    expect(dependencies.materialize).not.toHaveBeenCalled()
  })

  it('创建预览后，返回的 image_edit.preview 稳定引用可通过通用 list/read 读取', async () => {
    const preview = await createImageEditPreview({
      sourceRef: 'asset:source:1',
      source: 'C:/fixture/source-1.png',
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
      'image_edit.selection',
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
          id: `v3:${getStoredImageEditPreview(String(preview.previewRef))!.document.id}`,
        },
        'image_edit.preview.width': 600,
        'image_edit.preview.height': 800,
      },
    })
    const document = registrations.find((item) => item.entity.id === IMAGE_EDIT_ENTITY_TYPES.document)
    if (!document?.provider) throw new Error('IMAGE_EDIT_DOCUMENT_PROVIDER_MISSING')
    const snapshot = await document.provider.readEntity(
      { kind: IMAGE_EDIT_ENTITY_TYPES.document, id: `v3:${getStoredImageEditPreview(String(preview.previewRef))!.document.id}` },
      {},
    )
    expect(snapshot?.properties['image_edit.document.orientation_rotate']).toBe('90')
    expect(snapshot?.properties['image_edit.document.root_refs']).toHaveLength(1)
    const documentId = getStoredImageEditPreview(String(preview.previewRef))!.document.id
    const availability = await document.provider.getPropertyAvailability(
      { kind: IMAGE_EDIT_ENTITY_TYPES.document, id: `v3:${documentId}` },
      ['image_edit.document.orientation_rotate'],
    )
    expect(availability[0]).toMatchObject({ writable: false })
    expect(() => requireImageEditPersistenceOwnerV3(documentId)).toThrow('仅供预览')
  })

  it('继续编辑预览时保留 V3 图层并追加独立光效', async () => {
    const firstPreview = await createImageEditPreview({
      sourceRef: 'generation.result:source-1',
      source: 'C:/fixture/source-1.png',
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
    const existingDocument = parseImageEditDocumentV3(firstPreview.document)
    dependencies.ingest.mockRejectedValueOnce(new Error('原图地址已失效'))

    const result = await createImageEditPreviewFromRef({
      sourceRef: {
        kind: 'image_edit.preview',
        id: String(firstPreview.previewRef),
      },
      operations: [{ kind: 'vgpu_glow', look: 'neon' }],
    })
    const continuedPreview = getStoredImageEditPreview(String(result.previewRef))
    if (!continuedPreview) throw new Error('CONTINUED_PREVIEW_NOT_STORED')
    const continuedDocument = parseImageEditDocumentV3(continuedPreview.document)

    expect(continuedDocument.layers.filter(layer => layer.type === 'annotation')).toMatchObject([{ annotations: [{ id: 'existing-mark', type: 'rect' }] }])
    expect(continuedDocument.layers.find(layer => layer.type === 'effect' && layer.effectId === 'image.diffusion')).toEqual(existingDocument.layers.find(layer => layer.type === 'effect'))
    expect(continuedDocument.layers.at(-1)).toMatchObject({ type: 'effect', visible: true, effectId: 'image.vgpu-glow', params: { look: 'neon' } })
    expect(dependencies.ingest).toHaveBeenCalledTimes(1)
  })

  it('提交失败保留预览，成功后才结束会话并生成新素材', async () => {
    const preview = await createImageEditPreview({
      sourceRef: 'asset:source-1',
      source: 'C:/fixture/source-1.png',
      operations: [{ kind: 'flip_h' }],
    })
    dependencies.materialize.mockRejectedValueOnce(new Error('WRITE_FAILED'))
    await expect(commitImageEdit(String(preview.previewRef))).rejects.toThrow('WRITE_FAILED')

    await expect(commitImageEdit(String(preview.previewRef), '编辑结果')).resolves.toEqual({
      previewRef: preview.previewRef,
      assetId: 'asset-edited',
      status: 'committed',
      resultRefs: [{ kind: 'asset', id: 'asset-edited' }],
      verification: { verified: true, condition: '编辑图片已从正式素材存储回读并确认媒体可用', target: { kind: 'asset', id: 'asset-edited' } },
    })
    await expect(commitImageEdit(String(preview.previewRef))).rejects.toThrow('NOT_FOUND')
  })

  it.each(['missing', 'wrong-file', 'read-error'])('素材提交后的 %s 不得被报告为核实成功或再次创建', async (failure) => {
    const preview = await createImageEditPreview({ sourceRef: 'asset:source-1', source: 'C:/fixture/source-1.png', operations: [{ kind: 'flip_h' }] })
    if (failure === 'read-error') dependencies.inspectAsset.mockRejectedValueOnce(new Error('READ_FAILED'))
    else dependencies.inspectAsset.mockResolvedValueOnce({ id: 'asset-edited', filePath: failure === 'wrong-file' ? 'other.png' : 'C:\\managed\\edited.png', mediaType: 'image', inspectionStatus: failure === 'missing' ? 'missing' : 'ready' })
    const result = await commitImageEdit(String(preview.previewRef))
    expect(result).toMatchObject({ assetId: 'asset-edited', verification: { verified: false } })
    expect(dependencies.addMediaReferenceToLibrary).toHaveBeenCalledTimes(1)
  })
})
