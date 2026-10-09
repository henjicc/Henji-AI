// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditAnnotationLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
let releaseSession: (() => void) | undefined
let bus: ImageEditCommandBusV3
function createSession(id = 'mcp-mark-session') { const document = createImageEditDocumentV3({ width: 800, height: 600, documentId: id }); document.layers.push(createImageEditAnnotationLayerV3('marks', '标注')); bus = new ImageEditCommandBusV3(document); releaseSession = registerPersistedImageEditTestSession(id, bus); }
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { retainHostContextTracking } from '@/features/application-control/hostContext/hostContext'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

let dispose: () => void
beforeEach(() => { installHarnessNativeStorage(); releaseSession?.(); releaseSession = undefined; dispose = retainHostContextTracking() })
afterEach(() => { dispose(); vi.restoreAllMocks(); releaseSession?.(); releaseSession = undefined; uninstallHarnessNativeStorage() })
const parent = { kind: 'image_edit.layer', id: 'v3:mcp-mark-session:marks' }
const documentRef = { kind: 'image_edit.document', id: 'v3:mcp-mark-session' }
function client(write = true, destructive = true) {
  return createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-mark',
    capabilityIds: listApplicationCapabilities().map((value) => value.id), allowWrites: true, allowDestructive: destructive,
    permissions: ['application:read', 'application:write', 'image_mark:read', 'image_edit:read', 'image_edit:write', ...(write ? ['image_mark:write'] : [])] }))
}
const request = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
async function read(target: ReturnType<typeof client>, ref = parent, propertyIds = ['image_edit.layer.name']) {
  return target.execute({ id: 'read_application_entity', version: 1, input: { ref, propertyIds } }, request())
}
async function change(target: ReturnType<typeof client>, changes: unknown[], ref = parent) {
  const snapshot = await read(target, ref, ref.kind === 'image_mark.annotation' ? ['image_mark.annotation.data'] : ref.kind === 'image_edit.document' ? ['image_edit.document.orientation_rotate'] : undefined)
  expect(snapshot.ok, JSON.stringify(snapshot)).toBe(true)
  if (!snapshot.ok) throw new Error('缺少真实读取基线')
  return target.execute({ id: 'change_application_entities', version: 2, expectedRevisions: snapshot.data.revisions, input: { summary: '标注修改', changes } }, request())
}
const create = { kind: 'create_items', parent, entityType: 'image_mark.annotation', items: [{ properties: {
  'image_mark.annotation.type': 'rect', 'image_mark.annotation.data': { x: 10, y: 20, width: 100, height: 50, stroke: 'red', lineWidth: 3 },
} }] }

it('独立Session通过真实标注执行器增改删及文档修改，正式回读验证', async () => {
  createSession()
  const target = client()
  const rotated = await change(target, [{ kind: 'set_properties', target: documentRef, entityType: documentRef.kind, properties: { 'image_edit.document.orientation_rotate': '90' } }], documentRef)
  expect(rotated.ok, JSON.stringify(rotated)).toBe(true)
  const doc = await read(target, documentRef, ['image_edit.document.orientation_rotate'])
  expect(doc.ok && doc.data.properties).toEqual({ 'image_edit.document.orientation_rotate': '90' })
  const created = await change(target, [create])
  expect(created.ok, JSON.stringify(created)).toBe(true)
  const listed = await target.execute({ id: 'list_application_entities', version: 1, input: { entityType: 'image_mark.annotation' } }, request())
  expect(listed.ok, JSON.stringify(listed)).toBe(true)
  if (!listed.ok) throw new Error('标注未列出')
  const refs = listed.data.refs as Array<{ kind: string; id: string }>
  expect(refs).toHaveLength(1)
  const ref = refs[0]
  const modified = await change(target, [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { 'image_mark.annotation.data': { x: 15, y: 25, width: 100, height: 50, stroke: 'green', lineWidth: 3 } } }], ref)
  expect(modified.ok, JSON.stringify(modified)).toBe(true)
  const after = await read(target, ref, ['image_mark.annotation.data'])
  expect(after.ok && after.data.properties).toMatchObject({ 'image_mark.annotation.data': { x: 15, y: 25, stroke: 'green' } })
  const removed = await change(target, [{ kind: 'remove_items', parent, entityType: ref.kind, targets: [ref] }])
  expect(removed.ok, JSON.stringify(removed)).toBe(true)
  const end = await target.execute({ id: 'list_application_entities', version: 1, input: { entityType: 'image_mark.annotation' } }, request())
  expect(end.ok && end.data.refs).toEqual([])
})

it('缺标注写权限时拒绝，正式会话内容和提交次数均不变', async () => {
  createSession()
  const before = bus.getSnapshot().document
  const commit = vi.spyOn(bus, 'dispatch')
  const result = await change(client(false), [create])
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(commit).not.toHaveBeenCalled()
  expect(bus.getSnapshot().document).toEqual(before)
})

it('原会话消失后旧基线不能写入，也不借其他会话', async () => {
  createSession()
  const target = client(); const snapshot = await read(target)
  if (!snapshot.ok) throw new Error('缺少原基线')
  releaseSession?.(); releaseSession = undefined
  createSession('another-session')
  const before = bus.getSnapshot().document
  const commit = vi.spyOn(bus, 'dispatch')
  const result = await target.execute({ id: 'change_application_entities', version: 2, expectedRevisions: snapshot.data.revisions, input: { summary: '原会话恢复', changes: [create] } }, request())
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(commit).not.toHaveBeenCalled()
  expect(bus.getSnapshot().document).toEqual(before)
})
