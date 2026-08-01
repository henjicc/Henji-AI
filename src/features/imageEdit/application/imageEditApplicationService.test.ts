import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('image edit application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetImageEditApplicationStateForTests()
    dependencies.readImageInfo.mockResolvedValue({ width: 800, height: 600 })
    dependencies.exportImageEditDocument.mockResolvedValue('data:image/png;base64,edited')
    dependencies.persistImageSource.mockResolvedValue('C:\\managed\\edited.png')
    dependencies.addMediaReferenceToLibrary.mockResolvedValue({ id: 'asset-edited' })
  })

  it('使用统一控制 schema 创建会话、文档和编辑层反射', async () => {
    const preview = await createImageEditPreview({
      sourceRef: 'asset:source-1',
      source: 'henji-media://local/source-1',
      operations: [{ kind: 'rotate_cw', degrees: 90 }],
    })
    const registrations = createImageEditReflectionRegistrations()
    expect(registrations.map((item) => item.entity.id)).toEqual([
      IMAGE_EDIT_ENTITY_TYPES.session,
      IMAGE_EDIT_ENTITY_TYPES.document,
      IMAGE_EDIT_ENTITY_TYPES.layer,
    ])
    const document = registrations.find((item) => item.entity.id === IMAGE_EDIT_ENTITY_TYPES.document)
    if (!document?.provider) throw new Error('IMAGE_EDIT_DOCUMENT_PROVIDER_MISSING')
    const snapshot = await document.provider.readEntity(
      { kind: IMAGE_EDIT_ENTITY_TYPES.document, id: String(preview.previewRef) },
      {},
    )
    expect(snapshot?.properties['image_edit.document.layer_refs']).toHaveLength(3)
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
