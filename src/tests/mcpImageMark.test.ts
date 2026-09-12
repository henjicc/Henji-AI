// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { retainHostContextTracking } from '@/features/assistant/hostContext/hostContext'

let dispose: () => void
beforeEach(() => { useImageEditSessionStore.setState({ sessions: {}, revision: 0 }); dispose = retainHostContextTracking() })
afterEach(() => { dispose(); vi.restoreAllMocks(); useImageEditSessionStore.setState({ sessions: {}, revision: 0 }) })
const parent = { kind: 'image_mark.document', id: 'mcp-mark-session' }
function client(write = true, destructive = true) {
  return createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-mark',
    capabilityIds: listApplicationCapabilities().map((value) => value.id), allowWrites: true, allowDestructive: destructive,
    permissions: ['application:read', 'application:write', 'image_mark:read', ...(write ? ['image_mark:write'] : [])] }))
}
const request = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
async function read(target: ReturnType<typeof client>, ref = parent, propertyIds = ['image_mark.document.orientation_rotate']) {
  return target.execute({ id: 'read_application_entity', version: 1, input: { ref, propertyIds } }, request())
}
async function change(target: ReturnType<typeof client>, changes: unknown[], ref = parent) {
  const snapshot = await read(target, ref, ref.kind === 'image_mark.annotation' ? ['image_mark.annotation.data'] : undefined)
  expect(snapshot.ok, JSON.stringify(snapshot)).toBe(true)
  if (!snapshot.ok) throw new Error('缺少真实读取基线')
  return target.execute({ id: 'change_application_entities', version: 2, expectedRevisions: snapshot.data.revisions, input: { summary: '标注修改', changes } }, request())
}
const create = { kind: 'create_items', parent, entityType: 'image_mark.annotation', items: [{ properties: {
  'image_mark.annotation.type': 'rect', 'image_mark.annotation.data': { x: 10, y: 20, width: 100, height: 50, stroke: 'red', lineWidth: 3 },
} }] }

it('独立Session通过真实标注执行器增改删及文档修改，正式回读验证', async () => {
  useImageEditSessionStore.getState().ensureSession(parent.id, createEmptyImageEditDocument())
  const target = client()
  const rotated = await change(target, [{ kind: 'set_properties', target: parent, entityType: parent.kind, properties: { 'image_mark.document.orientation_rotate': '90' } }])
  expect(rotated.ok, JSON.stringify(rotated)).toBe(true)
  const doc = await read(target)
  expect(doc.ok && doc.data.properties).toEqual({ 'image_mark.document.orientation_rotate': '90' })
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
  useImageEditSessionStore.getState().ensureSession(parent.id, createEmptyImageEditDocument())
  const before = structuredClone(useImageEditSessionStore.getState().sessions)
  const commit = vi.spyOn(useImageEditSessionStore.getState(), 'commitDocument')
  const result = await change(client(false), [create])
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(commit).not.toHaveBeenCalled()
  expect(useImageEditSessionStore.getState().sessions).toEqual(before)
})

it('原会话消失后旧基线不能写入，也不借其他会话', async () => {
  useImageEditSessionStore.getState().ensureSession(parent.id, createEmptyImageEditDocument())
  const target = client(); const snapshot = await read(target)
  if (!snapshot.ok) throw new Error('缺少原基线')
  useImageEditSessionStore.setState({ sessions: {} })
  useImageEditSessionStore.getState().ensureSession('another-session', createEmptyImageEditDocument())
  const before = structuredClone(useImageEditSessionStore.getState().sessions)
  const commit = vi.spyOn(useImageEditSessionStore.getState(), 'commitDocument')
  const result = await target.execute({ id: 'change_application_entities', version: 2, expectedRevisions: snapshot.data.revisions, input: { summary: '原会话恢复', changes: [create] } }, request())
  expect(result.ok, JSON.stringify(result)).toBe(false)
  expect(commit).not.toHaveBeenCalled()
  expect(useImageEditSessionStore.getState().sessions).toEqual(before)
})
