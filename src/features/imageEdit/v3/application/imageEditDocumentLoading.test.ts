// @vitest-environment jsdom
import '@/tests/imageEditDocumentFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ensureImageEditDocumentInstanceV3 } from './imageEditDocumentLoading'
import { getOrCreateImageEditDocumentInstanceV3, listImageEditDocumentInstancesV3 } from './imageEditDocumentInstances'
import { ImageEditV3ReflectionProvider } from './imageEditV3Reflection'
import { imageEditV3LayerRef } from './imageEditDocumentRefs'
import { runImageEditPersistedOperationV3 } from './imageEditPersistenceOperations'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'

const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('@/commands/imageEditorV3', () => ({
  loadImageEditorV3Document: io.load,
  ImageEditorV3CommandRepository: class { save = io.save },
}))

function snapshot(): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({ width: 10, height: 10, documentId: 'unopened' })
  document.layers = [createImageEditRasterLayerV3('layer', '未打开的文档')]
  return { documentRef: 'image-edit-v3:unopened', revision: 0, previewRef: null, document,
    history: new ImageEditCommandBusV3(document).getPersistenceSnapshot().history,
    resources: [], resourceRefs: [], sourceFingerprint: `sha256:${'a'.repeat(64)}` }
}

beforeEach(() => {
  io.load.mockReset().mockResolvedValue(snapshot())
  io.save.mockReset().mockImplementation(async (document: ImageEditDocumentV3) => ({
    documentId: document.id, revision: document.revision, previewRef: null,
  }))
})

describe('离屏文档读取', () => {
  it('反射读取未打开文档，并发发现复用一次载入；修改保存无需挂载 React', async () => {
    const provider = new ImageEditV3ReflectionProvider('image_edit.layer')
    const [entity, instance] = await Promise.all([
      provider.readEntity(imageEditV3LayerRef('unopened', 'layer'), {}),
      ensureImageEditDocumentInstanceV3('unopened'),
    ])
    expect(entity.properties['image_edit.layer.name']).toBe('未打开的文档')
    expect(io.load).toHaveBeenCalledTimes(1)
    expect(instance.views).toBe(0)
    await runImageEditPersistedOperationV3('unopened', undefined, async () => {
      instance.bus.dispatch({ type: 'layer.update-common', commandId: 'background-change', expectedRevision: 0,
        layerId: 'layer', patch: { name: '后台已保存' } })
    })
    expect(io.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), expect.objectContaining({ expectedRevision: 0 }))
    expect((await provider.readEntity(imageEditV3LayerRef('unopened', 'layer'), {})).properties['image_edit.layer.name']).toBe('后台已保存')
    expect(listImageEditDocumentInstancesV3()).toEqual([instance])
    expect(instance.bus.getSnapshot().history.undoCount).toBe(1)
  })

  it('读取失败可重新载入；等待期间出现的正式实例不会被迟到快照替换', async () => {
    io.load.mockRejectedValueOnce(new Error('read unavailable'))
    await expect(ensureImageEditDocumentInstanceV3('unopened')).rejects.toThrow('read unavailable')
    let finish!: (value: ImageEditorV3DocumentSnapshot) => void
    io.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = ensureImageEditDocumentInstanceV3('unopened')
    const current = getOrCreateImageEditDocumentInstanceV3(snapshot().document)
    current.bus.dispatch({ type: 'layer.update-common', commandId: 'edit-during-load', expectedRevision: 0,
      layerId: 'layer', patch: { name: '新状态' } })
    finish(snapshot())
    expect(await pending).toBe(current)
    expect(current.bus.getSnapshot().document.layers[0].name).toBe('新状态')
    expect(io.load).toHaveBeenCalledTimes(2)
  })
})
