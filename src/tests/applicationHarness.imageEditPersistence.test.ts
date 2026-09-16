// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { getProjectRecord } from '@/commands/projectState'

let dispose: (() => void) | undefined
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { dispose?.(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('公共入口图片编辑保存拒绝后返回恢复事实，并只保存原修改一次', async () => {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'harness-durable-image' })
  document.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const bus = new ImageEditCommandBusV3(document)
  dispose = registerPersistedImageEditTestSession('harness-durable-session', bus, new ImageEditorV3CommandRepository())
  const saves = vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockRejectedValueOnce(new Error('readonly storage'))
  const app = createApplicationHarness()
  try {
    const result = await app.change({ kind: 'image_edit.layer', id: `v3:${document.id}:effect` }, { 'image_edit.layer.opacity': 0.42 })
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(JSON.stringify(result)).toContain('不要重复')
    const retry = await app.call('retry_image_edit_document_save', { documentRef: { kind: 'image_edit.document', id: `v3:${document.id}` } })
    expect(retry.ok, JSON.stringify(retry)).toBe(true)
  } finally { app.dispose() }
  const saved = readHarnessImageEditDocument(document.id)!
  expect(saved.document.revision).toBe(1)
  expect(saved.document.layers[0].opacity).toBe(0.42)
  expect(saved.history?.undo).toHaveLength(1)
  expect(bus.getPersistenceSnapshot().history).toEqual(saved.history)
  expect(saves).toHaveBeenCalledTimes(2)
})

it('附着图片通过公共调用 修改后，文档与画布节点持久化事实和级联回执一致', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  dispose = fixture.dispose
  const app = createApplicationHarness()
  const result = await app.change({ kind: 'image_edit.layer', id: `v3:${fixture.document.id}:effect` }, { 'image_edit.layer.opacity': 0.42 })
  app.dispose()
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error('图片修改失败')
  const saved = readHarnessImageEditDocument(fixture.document.id)!
  const nodes = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(saved.document.layers[0].opacity).toBe(0.42)
  expect(nodes[0].data.imageEditSession.revision).toBe(saved.document.revision)
  expect(nodes[0].data.imageEditSession.previewRef).toBe(saved.previewRef)
  expect(fixture.queue.getReference().previewRef).toBe(saved.previewRef)
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
  expect(result.data.effects).toEqual(expect.arrayContaining([expect.objectContaining({
    effect: 'update', entityType: 'canvas.node', refs: expect.arrayContaining([expect.objectContaining({ id: `${fixture.projectId}:attached-node` })]),
  })]))
})
