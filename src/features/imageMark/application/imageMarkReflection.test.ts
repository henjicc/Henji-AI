// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'

import type { ApplicationControlAccessContext, ApplicationExecutionContext } from '@/core/application-control'
import { createImageEditDocumentV3, createImageEditAnnotationLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { imageMarkRevision } from './imageMarkSessionAccess'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
const disposers: Array<() => void> = []
function createSession(id: string) { const document = createImageEditDocumentV3({ width: 800, height: 600, documentId: id }); document.layers.push(createImageEditAnnotationLayerV3('marks', '标注')); const bus = new ImageEditCommandBusV3(document); disposers.push(registerPersistedImageEditTestSession(id, bus)); return bus; }

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '../../application-control/capabilities/applicationControlRegistry'

const accessContext: ApplicationControlAccessContext = {
  exposure: 'assistant',
  permissions: new Set(['image_mark:read', 'image_mark:write', 'image_edit:read', 'image_edit:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

const executionContext: ApplicationExecutionContext = {
  ...accessContext,
  requestId: 'image-mark-reflection-test',
}

function resetStore(): void {
  while (disposers.length) disposers.pop()?.()
}

describe('image_mark 反射与执行器（6.2）', () => {
  beforeEach(installHarnessNativeStorage)
  afterEach(() => {
    resetStore()
    uninstallHarnessNativeStorage()
  })

  it('没有打开任何编辑器时，文档与标注列表都是空的', async () => {
    const registry = getApplicationReflectionRegistry()
    const documents = await registry.listEntities('image_edit.document', { limit: 10 }, accessContext)
    const annotations = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(documents.refs).toEqual([])
    expect(annotations.refs).toEqual([])
  })

  it('打开编辑器后能读到默认文档，改裁剪与旋转可撤销', async () => {
    createSession('session-a')
    const registry = getApplicationReflectionRegistry()

    const listed = await registry.listEntities('image_edit.document', { limit: 10 }, accessContext)
    expect(listed.refs).toEqual([{ kind: 'image_edit.document', id: 'v3:session-a' }])

    const snapshot = await registry.readEntity({ kind: 'image_edit.document', id: 'v3:session-a' }, undefined, accessContext)
    expect(snapshot.properties['image_edit.document.orientation_rotate']).toBe('0')
    expect(snapshot.properties['image_edit.document.orientation_mirrored']).toBe(false)
    expect(snapshot.properties['image_edit.document.crop_rect']).toBeNull()

    const engine = getApplicationControlExecutionEngine()
    const revision = snapshot.revisions.image_edit
    const plan = await engine.plan({
      summary: '旋转并裁剪',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'image_edit.document', id: 'v3:session-a' },
        entityType: 'image_edit.document',
        expectedRevisions: { image_edit: revision },
        mutations: [
          { propertyId: 'image_edit.document.orientation_rotate', operation: 'set', value: '90' },
          { propertyId: 'image_edit.document.crop_rect', operation: 'set', value: { x: 1, y: 2, width: 30, height: 40 } },
        ],
      }],
    }, executionContext)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { image_edit: revision },
      idempotencyKey: 'image-mark-document-commit',
    }, executionContext)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')

    const after = await registry.readEntity({ kind: 'image_edit.document', id: 'v3:session-a' }, undefined, accessContext)
    expect(after.properties['image_edit.document.orientation_rotate']).toBe('90')
    expect(after.properties['image_edit.document.crop_rect']).toEqual({ x: 1, y: 2, width: 30, height: 40 })

    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')
    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'image-mark-document-undo',
    }, executionContext)
    expect(undone.status).toBe('completed')
    const restored = await registry.readEntity({ kind: 'image_edit.document', id: 'v3:session-a' }, undefined, accessContext)
    expect(restored.properties['image_edit.document.orientation_rotate']).toBe('0')
    expect(restored.properties['image_edit.document.crop_rect']).toBeNull()
  })

  it('通用文档旋转清除旧裁剪，同次显式裁剪不依赖属性顺序，并可撤销', async () => {
    const bus = createSession('geometry-switch')
    const ref = { kind: 'image_edit.document', id: 'v3:geometry-switch' }
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine()
    const change = async (properties: Record<string, import('@/core/application-control').JsonValue>, key: string) => {
      const snapshot = await registry.readEntity(ref, undefined, accessContext)
      const expectedRevisions = { image_edit: snapshot.revisions.image_edit }
      const plan = await engine.plan({ summary: key, transactionMode: 'atomic', steps: [{ kind: 'mutation', target: ref, entityType: ref.kind, expectedRevisions, mutations: Object.entries(properties).map(([propertyId, value]) => ({ propertyId, operation: 'set' as const, value })) }] }, executionContext)
      const result = await engine.commit({ planRef: plan.planRef, expectedRevisions, idempotencyKey: `image-mark-geometry-${key}` }, executionContext)
      expect(result.status, JSON.stringify(result)).toBe('completed')
      return result
    }
    await change({ 'image_edit.document.crop_rect': { x: 0, y: 0, width: 700, height: 500 } }, 'initial-crop')
    const rotated = await change({ 'image_edit.document.orientation_rotate': '90' }, 'rotate-clears-crop')
    expect(bus.getSnapshot().document.geometry.crop).toBeNull()
    if (rotated.status !== 'completed' || !rotated.undoRef) throw new Error('UNDO_MISSING')
    expect((await engine.undo({ undoRef: rotated.undoRef, expectedRevisions: rotated.resultingRevisions, idempotencyKey: 'image-mark-geometry-undo-rotation' }, executionContext)).status).toBe('completed')
    expect(bus.getSnapshot().document.geometry.crop).toMatchObject({ width: 700, height: 500 })
    await change({ 'image_edit.document.crop_rect': { x: 1, y: 2, width: 20, height: 40 }, 'image_edit.document.orientation_rotate': '90' }, 'explicit-crop-before-rotation')
    expect(bus.getSnapshot().document.geometry.crop).toEqual({ x: 1, y: 2, width: 20, height: 40 })
  })

  it('能新建一条矩形标注、改它的颜色与位置，再删掉它', async () => {
    createSession('session-b')
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine()

    const initialRevision = imageMarkRevision()
    const createPlan = await engine.plan({
      summary: '新建矩形标注',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection',
        parent: { kind: 'image_edit.layer', id: 'v3:session-b:marks' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: initialRevision, image_edit: initialRevision },
        operation: {
          kind: 'create',
          items: [{
            properties: {
              'image_mark.annotation.type': 'rect',
              'image_mark.annotation.data': { x: 10, y: 20, width: 100, height: 50, stroke: 'red', lineWidth: 3 },
            },
          }],
        },
      }],
    }, executionContext)
    const created = await engine.commit({
      planRef: createPlan.planRef,
      expectedRevisions: { image_mark: initialRevision, image_edit: initialRevision },
      idempotencyKey: 'image-mark-annotation-create',
    }, executionContext)
    expect(created.status, JSON.stringify(created)).toBe('completed')
    if (created.status !== 'completed') throw new Error('unreachable')
    const annotationRef = created.resultRefs[0]
    expect(annotationRef.id.startsWith('v3:session-b:marks:')).toBe(true)

    const listed = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(listed.refs).toHaveLength(1)

    const snapshot = await registry.readEntity(annotationRef, undefined, accessContext)
    expect(snapshot.properties['image_mark.annotation.type']).toBe('rect')
    expect(snapshot.properties['image_mark.annotation.data']).toMatchObject({ x: 10, y: 20, stroke: 'red' })

    const editPlan = await engine.plan({
      summary: '改标注颜色与位置',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: annotationRef,
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: snapshot.revisions.image_mark, image_edit: snapshot.revisions.image_mark },
        mutations: [
          { propertyId: 'image_mark.annotation.data', operation: 'set', value: { x: 15, y: 25, width: 100, height: 50, stroke: 'green', lineWidth: 3 } },
        ],
      }],
    }, executionContext)
    const edited = await engine.commit({
      planRef: editPlan.planRef,
      expectedRevisions: { image_mark: snapshot.revisions.image_mark, image_edit: snapshot.revisions.image_mark },
      idempotencyKey: 'image-mark-annotation-edit',
    }, executionContext)
    expect(edited.status, JSON.stringify(edited)).toBe('completed')

    const afterEdit = await registry.readEntity(annotationRef, undefined, accessContext)
    expect(afterEdit.properties['image_mark.annotation.data']).toMatchObject({ x: 15, y: 25, stroke: 'green' })

    const removePlan = await engine.plan({
      summary: '删除标注',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection',
        parent: { kind: 'image_edit.layer', id: 'v3:session-b:marks' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: afterEdit.revisions.image_mark, image_edit: afterEdit.revisions.image_mark },
        operation: { kind: 'remove', targets: [annotationRef] },
      }],
    }, executionContext)
    const removed = await engine.commit({
      planRef: removePlan.planRef,
      expectedRevisions: { image_mark: afterEdit.revisions.image_mark, image_edit: afterEdit.revisions.image_mark },
      idempotencyKey: 'image-mark-annotation-remove',
    }, executionContext)
    expect(removed.status, JSON.stringify(removed)).toBe('completed')

    const finalList = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(finalList.refs).toEqual([])
  })

  it('多会话隔离：往一个会话写标注不影响另一个会话', async () => {
    createSession('session-c')
    createSession('session-d')
    const engine = getApplicationControlExecutionEngine()
    const registry = getApplicationReflectionRegistry()

    const initialRevision = imageMarkRevision()
    const plan = await engine.plan({
      summary: '往 session-c 画一个矩形',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection',
        parent: { kind: 'image_edit.layer', id: 'v3:session-c:marks' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: initialRevision, image_edit: initialRevision },
        operation: {
          kind: 'create',
          items: [{
            properties: {
              'image_mark.annotation.type': 'rect',
              'image_mark.annotation.data': { x: 0, y: 0, width: 10, height: 10, stroke: 'black', lineWidth: 1 },
            },
          }],
        },
      }],
    }, executionContext)
    await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { image_mark: initialRevision, image_edit: initialRevision },
      idempotencyKey: 'image-mark-isolation-commit',
    }, executionContext)

    const all = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(all.refs).toHaveLength(1)
    expect(all.refs[0].id.startsWith('v3:session-c:marks:')).toBe(true)

    const sessionDDoc = await registry.readEntity({ kind: 'image_edit.document', id: 'v3:session-d' }, undefined, accessContext)
    expect(sessionDDoc.properties['image_edit.document.crop_rect']).toBeNull()
  })
})
