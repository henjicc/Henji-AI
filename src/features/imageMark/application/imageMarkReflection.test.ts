// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import type { ApplicationControlAccessContext, ApplicationExecutionContext } from '@/core/application-control'
import { createEmptyImageEditDocument } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '../../assistant/applicationCapabilities/applicationControlRegistry'

const accessContext: ApplicationControlAccessContext = {
  exposure: 'assistant',
  permissions: new Set(['image_mark:read', 'image_mark:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

const executionContext: ApplicationExecutionContext = {
  ...accessContext,
  requestId: 'image-mark-reflection-test',
}

function resetStore(): void {
  useImageEditSessionStore.setState({ sessions: {}, revision: 0 })
}

describe('image_mark 反射与执行器（6.2）', () => {
  afterEach(() => {
    resetStore()
  })

  it('没有打开任何编辑器时，文档与标注列表都是空的', async () => {
    const registry = getApplicationReflectionRegistry()
    const documents = await registry.listEntities('image_mark.document', { limit: 10 }, accessContext)
    const annotations = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(documents.refs).toEqual([])
    expect(annotations.refs).toEqual([])
  })

  it('打开编辑器后能读到默认文档，改裁剪与旋转可撤销', async () => {
    useImageEditSessionStore.getState().ensureSession('session-a', createEmptyImageEditDocument())
    const registry = getApplicationReflectionRegistry()

    const listed = await registry.listEntities('image_mark.document', { limit: 10 }, accessContext)
    expect(listed.refs).toEqual([{ kind: 'image_mark.document', id: 'session-a' }])

    const snapshot = await registry.readEntity({ kind: 'image_mark.document', id: 'session-a' }, undefined, accessContext)
    expect(snapshot.properties['image_mark.document.orientation_rotate']).toBe('0')
    expect(snapshot.properties['image_mark.document.orientation_mirrored']).toBe(false)
    expect(snapshot.properties['image_mark.document.crop_rect']).toBeNull()

    const engine = getApplicationControlExecutionEngine()
    const revision = snapshot.revisions.image_mark
    const plan = await engine.plan({
      summary: '旋转并裁剪',
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'image_mark.document', id: 'session-a' },
        entityType: 'image_mark.document',
        expectedRevisions: { image_mark: revision },
        mutations: [
          { propertyId: 'image_mark.document.orientation_rotate', operation: 'set', value: '90' },
          { propertyId: 'image_mark.document.crop_rect', operation: 'set', value: { x: 1, y: 2, width: 30, height: 40 } },
        ],
      }],
    }, executionContext)
    const committed = await engine.commit({
      planRef: plan.planRef,
      expectedRevisions: { image_mark: revision },
      idempotencyKey: 'image-mark-document-commit',
    }, executionContext)
    expect(committed.status, JSON.stringify(committed)).toBe('completed')

    const after = await registry.readEntity({ kind: 'image_mark.document', id: 'session-a' }, undefined, accessContext)
    expect(after.properties['image_mark.document.orientation_rotate']).toBe('90')
    expect(after.properties['image_mark.document.crop_rect']).toEqual({ x: 1, y: 2, width: 30, height: 40 })

    if (committed.status !== 'completed' || !committed.undoRef) throw new Error('UNDO_REF_MISSING')
    const undone = await engine.undo({
      undoRef: committed.undoRef,
      expectedRevisions: committed.resultingRevisions,
      idempotencyKey: 'image-mark-document-undo',
    }, executionContext)
    expect(undone.status).toBe('completed')
    const restored = await registry.readEntity({ kind: 'image_mark.document', id: 'session-a' }, undefined, accessContext)
    expect(restored.properties['image_mark.document.orientation_rotate']).toBe('0')
    expect(restored.properties['image_mark.document.crop_rect']).toBeNull()
  })

  it('能新建一条矩形标注、改它的颜色与位置，再删掉它', async () => {
    useImageEditSessionStore.getState().ensureSession('session-b', createEmptyImageEditDocument())
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine()

    const initialRevision = (await registry.readEntity({ kind: 'image_mark.document', id: 'session-b' }, undefined, accessContext)).revisions.image_mark
    const createPlan = await engine.plan({
      summary: '新建矩形标注',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection',
        parent: { kind: 'image_mark.document', id: 'session-b' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: initialRevision },
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
      expectedRevisions: { image_mark: initialRevision },
      idempotencyKey: 'image-mark-annotation-create',
    }, executionContext)
    expect(created.status, JSON.stringify(created)).toBe('completed')
    if (created.status !== 'completed') throw new Error('unreachable')
    const annotationRef = created.resultRefs[0]
    expect(annotationRef.id.startsWith('session-b:')).toBe(true)

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
        expectedRevisions: { image_mark: snapshot.revisions.image_mark },
        mutations: [
          { propertyId: 'image_mark.annotation.data', operation: 'set', value: { x: 15, y: 25, width: 100, height: 50, stroke: 'green', lineWidth: 3 } },
        ],
      }],
    }, executionContext)
    const edited = await engine.commit({
      planRef: editPlan.planRef,
      expectedRevisions: { image_mark: snapshot.revisions.image_mark },
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
        parent: { kind: 'image_mark.document', id: 'session-b' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: afterEdit.revisions.image_mark },
        operation: { kind: 'remove', targets: [annotationRef] },
      }],
    }, executionContext)
    const removed = await engine.commit({
      planRef: removePlan.planRef,
      expectedRevisions: { image_mark: afterEdit.revisions.image_mark },
      idempotencyKey: 'image-mark-annotation-remove',
    }, executionContext)
    expect(removed.status, JSON.stringify(removed)).toBe('completed')

    const finalList = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(finalList.refs).toEqual([])
  })

  it('多会话隔离：往一个会话写标注不影响另一个会话', async () => {
    useImageEditSessionStore.getState().ensureSession('session-c', createEmptyImageEditDocument())
    useImageEditSessionStore.getState().ensureSession('session-d', createEmptyImageEditDocument())
    const engine = getApplicationControlExecutionEngine()
    const registry = getApplicationReflectionRegistry()

    const initialRevision = (await registry.readEntity({ kind: 'image_mark.document', id: 'session-c' }, undefined, accessContext)).revisions.image_mark
    const plan = await engine.plan({
      summary: '往 session-c 画一个矩形',
      transactionMode: 'atomic',
      steps: [{
        kind: 'collection',
        parent: { kind: 'image_mark.document', id: 'session-c' },
        entityType: 'image_mark.annotation',
        expectedRevisions: { image_mark: initialRevision },
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
      expectedRevisions: { image_mark: initialRevision },
      idempotencyKey: 'image-mark-isolation-commit',
    }, executionContext)

    const all = await registry.listEntities('image_mark.annotation', { limit: 10 }, accessContext)
    expect(all.refs).toHaveLength(1)
    expect(all.refs[0].id.startsWith('session-c:')).toBe(true)

    const sessionDDoc = await registry.readEntity({ kind: 'image_mark.document', id: 'session-d' }, undefined, accessContext)
    expect(sessionDDoc.properties['image_mark.document.crop_rect']).toBeNull()
  })
})
