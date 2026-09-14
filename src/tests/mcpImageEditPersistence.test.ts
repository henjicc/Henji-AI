// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { getHostScopeRevisions, retainHostContextTracking } from '@/features/assistant/hostContext/hostContext'
import { getProjectRecord } from '@/commands/projectState'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { installHarnessNativeStorage, readHarnessImageEditDocument, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { createAttachedImageEditPersistenceFixture } from './imageEditAttachedPersistenceFixture'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import { applicationTransactionFailureFactsSchema } from '@/core/assistant/applicationTransactionFailureFacts'

const disposers: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage(); disposers.push(retainHostContextTracking()) })
afterEach(() => { disposers.splice(0).reverse().forEach((dispose) => dispose()); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function session() {
  return createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-image-test',
    capabilityIds: listApplicationCapabilities().map((item) => item.id), allowWrites: true, allowDestructive: false,
    permissions: ['application:read', 'application:write', 'image_edit:read', 'image_edit:write', 'canvas:read', 'canvas:write', 'canvas:project_write'] }))
}
const request = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
async function edit(target: ReturnType<typeof session>, documentId: string) {
  const ref = { kind: 'image_edit.layer', id: `v3:${documentId}:effect` }
  const read = await target.execute({ id: 'read_application_entity', version: 1, input: { ref, propertyIds: ['image_edit.layer.opacity'] } }, request())
  expect(read.ok, JSON.stringify(read)).toBe(true)
  if (!read.ok) throw new Error('未取得正式基线')
  return target.execute({ id: 'change_application_entities', version: 2, expectedRevisions: read.data.revisions, input: {
    summary: '修改附着图片透明度', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'image_edit.layer.opacity': 0.42 } }],
  } }, request())
}
function originalOwnerId(result: Awaited<ReturnType<typeof edit>>): string {
  if (result.ok) throw new Error('必须来自原保存失败')
  const facts = applicationTransactionFailureFactsSchema.parse(result.error.details?.transaction)
  const ownerId = facts.persistence?.recovery.ownerId
  expect(ownerId).toMatch(/^[0-9a-f-]{36}$/)
  if (!ownerId) throw new Error('原失败缺少保存宿主身份')
  return ownerId
}
function retry(target: ReturnType<typeof session>, documentId: string, expectedOwnerId?: string) {
  return target.execute({ id: 'retry_image_edit_document_save', version: 1, expectedRevisions: getHostScopeRevisions(),
    input: { documentRef: { kind: 'image_edit.document', id: `v3:${documentId}` }, ...(expectedOwnerId ? { expectedOwnerId } : {}) } }, request())
}

it('独立应用入口附着图片双域保存失败保留真实修改与原恢复目标', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture(); disposers.push(fixture.dispose)
  vi.spyOn(window.henjiNative!.storyboardProjects, 'upsertProjectRecord').mockRejectedValueOnce(new Error('storage denied'))
  const result = await edit(session(), fixture.document.id)
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(result).toMatchObject({ error: { details: { transaction: {
    replayMutation: false,
    persistence: { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'projection' },
    effects: expect.arrayContaining([expect.objectContaining({ entityType: 'image_edit.layer' })]),
  } } } })
  expect(JSON.stringify(result)).toContain('retry_image_edit_document_save')
  expect(JSON.stringify(result)).toContain(`v3:${fixture.document.id}`)
  expect(readHarnessImageEditDocument(fixture.document.id)!.document.layers[0].opacity).toBe(0.42)
  expect(fixture.bus.getPersistenceSnapshot().history.undo).toHaveLength(1)
  const persisted = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(persisted[0].data.imageEditSession.revision).toBe(0)
})

it('仅重试原保存，文档和画布正式回读一致且编辑命令不重复', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture(); disposers.push(fixture.dispose)
  const target = session()
  vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockRejectedValueOnce(new Error('storage denied'))
  const failed = await edit(target, fixture.document.id)
  const result = await retry(target, fixture.document.id, originalOwnerId(failed))
  expect(result.ok, JSON.stringify(result)).toBe(true)
  const saved = readHarnessImageEditDocument(fixture.document.id)!
  const nodes = JSON.parse((await getProjectRecord(fixture.projectId))!.nodesJson)
  expect(saved.document.layers[0].opacity).toBe(0.42)
  expect(saved.document.revision).toBe(1)
  expect(saved.history?.undo).toHaveLength(1)
  expect(nodes[0].data.imageEditSession.revision).toBe(saved.document.revision)
  expect(nodes[0].data.imageEditSession.previewRef).toBe(saved.previewRef)
  expect(fixture.materialize).toHaveBeenCalledTimes(1)
  const readback = await target.execute({ id: 'read_application_entity', version: 1, input: { ref: { kind: 'image_edit.layer', id: `v3:${fixture.document.id}:effect` }, propertyIds: ['image_edit.layer.opacity'] } }, request())
  expect(readback.ok && readback.data.properties).toEqual({ 'image_edit.layer.opacity': 0.42 })
})

it('同一文档换成工具箱保存宿主后，原 owner 身份禁止旧恢复且不改变实际结果', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  const target = session()
  vi.spyOn(window.henjiNative!.storyboardProjects, 'upsertProjectRecord').mockRejectedValueOnce(new Error('storage denied'))
  const failed = await edit(target, fixture.document.id)
  const ownerId = originalOwnerId(failed)
  const originalFacts = structuredClone(failed)
  const originalSaved = structuredClone(readHarnessImageEditDocument(fixture.document.id))
  const originalProject = await getProjectRecord(fixture.projectId)
  fixture.dispose()
  const replacement = new ImageEditCommandBusV3(structuredClone(fixture.bus.getPersistenceSnapshot().document))
  disposers.push(registerPersistedImageEditTestSession('same-document-toolbox', replacement, new ImageEditorV3CommandRepository()))
  const saves = vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument')
  const previousSaves = saves.mock.calls.length
  const previousSnapshot = replacement.getPersistenceSnapshot()
  const result = await retry(target, fixture.document.id, ownerId)
  expect(result.ok, JSON.stringify(result)).toBe(false)
  if (!result.ok) expect(result.error.message).toContain('RECOVERY_SESSION_LOST')
  expect(saves.mock.calls.length).toBe(previousSaves)
  expect(replacement.getPersistenceSnapshot()).toEqual(previousSnapshot)
  expect(readHarnessImageEditDocument(fixture.document.id)).toEqual(originalSaved)
  expect(await getProjectRecord(fixture.projectId)).toEqual(originalProject)
  expect(failed).toEqual(originalFacts)
})

it('原画布图片会话关闭后拒绝恢复，不借用另一个工具箱会话', async () => {
  const fixture = await createAttachedImageEditPersistenceFixture()
  const target = session()
  vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument').mockRejectedValueOnce(new Error('storage denied'))
  expect((await edit(target, fixture.document.id)).ok).toBe(false)
  fixture.dispose()
  const other = createImageEditDocumentV3({ width: 8, height: 8, documentId: 'toolbox-other' })
  other.layers = [createImageEditEffectLayerV3('effect', '模糊', 'image.gaussian-blur-v2', { radius: 8 })]
  const otherBus = new ImageEditCommandBusV3(other)
  disposers.push(registerPersistedImageEditTestSession('toolbox-other-session', otherBus, new ImageEditorV3CommandRepository()))
  const saves = vi.spyOn(window.henjiNative!.imageEditorV3, 'saveDocument')
  const before = saves.mock.calls.length
  const result = await retry(target, fixture.document.id)
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(saves.mock.calls.length).toBe(before)
  expect(otherBus.getPersistenceSnapshot().document.revision).toBe(0)
  expect(readHarnessImageEditDocument(other.id)).toBeNull()
})
