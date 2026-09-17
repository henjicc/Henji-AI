// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { getProjectRecord } from '@/commands/projectState'
import { applicationTransactionFailureFactsSchema } from '@/core/application-control/applicationTransactionFailureFacts'

const cleanup: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage() })
afterEach(() => { cleanup.splice(0).reverse().forEach((dispose) => dispose()); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('两个独立公共调用方 的 layer/group 交叉 scope 修改共享锁，存储确认不重叠', async () => {
  const documents = ['one', 'two'].map((id) => createImageEditDocumentV3({ width: 8, height: 8, documentId: `gateway-concurrency-${id}` }))
  documents[0].layers = [createImageEditEffectLayerV3('layer', '原图层', 'image.gaussian-blur-v2', { radius: 8 })]
  documents[1].layers = [createImageEditGroupLayerV3('group', '原组')]
  const buses = documents.map((document) => new ImageEditCommandBusV3(document))
  buses.forEach((bus, index) => cleanup.push(registerPersistedImageEditTestSession(`gateway-concurrent-${index}`, bus, new ImageEditorV3CommandRepository())))
  let active = 0, peak = 0
  const original = window.henjiNative!.imageEditorV3.saveDocument
  vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockImplementation(async (input) => {
    active += 1; peak = Math.max(peak, active)
    try { await new Promise((resolve) => setTimeout(resolve, 30)); return await original(input) }
    finally { active -= 1 }
  })
  const apps = [createApplicationHarness(), createApplicationHarness()]
  apps.forEach(app => cleanup.push(app.dispose))
  const results = await Promise.all(apps.map((app, index) => {
    const type = index === 0 ? 'layer' : 'group'
    return app.change({ kind: `image_edit.${type}`, id: `v3:${documents[index].id}:${type}` }, { [`image_edit.${type}.name`]: `已修改${index}` })
  }))
  // 当前领域版本仍是共享的；冲突明确代表零写入，重新读取后可提交。
  expect(results.filter(result => result.ok)).toHaveLength(1)
  const rejectedIndex = results.findIndex(result => !result.ok)
  expect(results[rejectedIndex]).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  const type = rejectedIndex === 0 ? 'layer' : 'group'
  expect(readHarnessImageEditDocument(documents[rejectedIndex].id)).toBeNull()
  const retried = await apps[rejectedIndex].change({ kind: `image_edit.${type}`, id: `v3:${documents[rejectedIndex].id}:${type}` }, { [`image_edit.${type}.name`]: `已修改${rejectedIndex}` })
  expect(retried.ok, JSON.stringify(retried)).toBe(true)
  expect(peak).toBe(1)
  documents.forEach((document, index) => {
    const saved = readHarnessImageEditDocument(document.id)!
    expect(saved.document.layers[0].name).toBe(`已修改${index}`)
    expect(saved.document.revision).toBe(1)
    expect(saved.history?.undo).toHaveLength(1)
  })
})

it('附着图片 name trim 后公共调用保留双域事实和撤销，仍为 partial 而非假成功', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  cleanup.push(fixture.dispose)
  const app = createApplicationHarness(); cleanup.push(app.dispose)
  const result = await app.change({ kind: 'image_edit.layer', id: `v3:${fixture.document.id}:effect` }, { 'image_edit.layer.name': '  已修改  ' })
  expect(result.ok, JSON.stringify(result)).toBe(false)
  if (result.ok) throw new Error('必须拒绝不一致读回')
  const facts = applicationTransactionFailureFactsSchema.parse(result.error.details?.transaction)
  expect(facts).toMatchObject({ code: 'VERIFICATION_FAILED', replayMutation: false, undoRef: expect.any(String),
    partial: { completedStepIndexes: [0], uncompensatedStepIndexes: [0] },
    currentRevisions: { image_edit: expect.any(Number), canvas: expect.any(Number) } })
  expect(facts.effects?.map((effect) => effect.entityType)).toEqual(expect.arrayContaining(['image_edit.layer', 'canvas.node']))
  expect(facts.replayMutation).toBe(false)
  const saved = readHarnessImageEditDocument(fixture.document.id)!
  expect(saved.document.layers[0].name).toBe('已修改')
  expect(saved.document.revision).toBe(1)
  expect(saved.history?.undo).toHaveLength(1)
  const nodes = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(nodes[0].data.imageEditSession.revision).toBe(saved.document.revision)
  expect(nodes[0].data.imageEditSession.previewRef).toBe(saved.previewRef)
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
})
