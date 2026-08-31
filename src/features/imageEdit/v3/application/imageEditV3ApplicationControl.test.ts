// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import type { ApplicationControlAccessContext, ApplicationExecutionContext } from '@/core/application-control'
import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import {
  imageEditV3DocumentRef,
  imageEditV3GroupRef,
  imageEditV3LayerRef,
  imageEditV3MaskRef,
  imageEditV3ResourceRef,
  registerImageEditV3LiveSession,
  splitImageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import { imageMarkRevision } from '@/features/imageMark/application/imageMarkSessionAccess'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '@/features/assistant/applicationCapabilities/applicationControlRegistry'

const accessContext: ApplicationControlAccessContext = {
  exposure: 'assistant',
  permissions: new Set(['image_edit:read', 'image_edit:write', 'image_mark:read', 'image_mark:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

const executionContext: ApplicationExecutionContext = {
  ...accessContext,
  requestId: 'image-edit-v3-application-control-test',
}

const disposers: Array<() => void> = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
})

async function commitStep(
  summary: string,
  expectedRevisions: Record<string, number>,
  step: Parameters<ReturnType<typeof getApplicationControlExecutionEngine>['plan']>[0]['steps'][number],
  nonce: string,
) {
  const engine = getApplicationControlExecutionEngine()
  const plan = await engine.plan({
    summary,
    transactionMode: 'atomic',
    steps: [step],
  }, executionContext)
  return engine.commit({
    planRef: plan.planRef,
    expectedRevisions,
    idempotencyKey: `image-edit-v3-${nonce}-commit`,
  }, executionContext)
}

describe('图片编辑 V3 实时 Application Control', () => {
  it('实时 V3 图层属性和蒙版反相经通用事务写回同一命令总线并可撤销', async () => {
    const document = createImageEditDocumentV3({ width: 1280, height: 720, documentId: 'assistant-v3-doc-a' })
    const raster = {
      ...createImageEditRasterLayerV3('paint-a', '画笔', 'sha256:source-a'),
      mask: {
        ...createImageEditSparseMaskReferenceV3('mask-a'),
        tiles: {
          '0/0/0': 'sha256:mask-tile-a',
          '0/1/0': 'sha256:mask-tile-b',
          '0/2/0': 'sha256:mask-tile-a',
        },
      },
    }
    const effect = createImageEditEffectLayerV3(
      'blur-a',
      '模糊',
      'image.gaussian-blur-v2',
      { radius: 8 },
    )
    effect.mask = { resourceId: 'sha256:legacy-mask-a', inverted: false }
    document.layers = [raster, effect]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerImageEditV3LiveSession('assistant-v3-session-a', bus))

    const registry = getApplicationReflectionRegistry()
    const documentRef = imageEditV3DocumentRef(document.id)
    const documentSnapshot = await registry.readEntity(documentRef, undefined, accessContext)
    expect(documentSnapshot.properties['image_edit.document.root_refs']).toEqual([
      imageEditV3LayerRef(document.id, raster.id),
      imageEditV3LayerRef(document.id, effect.id),
    ])
    const resources = await registry.listEntities('image_edit.resource', { limit: 10 }, accessContext)
    expect(resources.refs).toEqual([
      imageEditV3ResourceRef(document.id, 'sha256:legacy-mask-a'),
      imageEditV3ResourceRef(document.id, 'sha256:mask-tile-a'),
      imageEditV3ResourceRef(document.id, 'sha256:mask-tile-b'),
      imageEditV3ResourceRef(document.id, 'sha256:source-a'),
    ])
    const sourceResource = await registry.readEntity(
      imageEditV3ResourceRef(document.id, 'sha256:source-a'),
      undefined,
      accessContext,
    )
    expect(sourceResource.properties).toMatchObject({
      'image_edit.resource.resource_id': 'sha256:source-a',
      'image_edit.resource.roles': ['raster-source'],
      'image_edit.resource.layer_refs': [imageEditV3LayerRef(document.id, raster.id)],
    })

    const effectRef = imageEditV3LayerRef(document.id, effect.id)
    const effectSnapshot = await registry.readEntity(effectRef, undefined, accessContext)
    const layerRevision = effectSnapshot.revisions.image_edit
    const changed = await commitStep('调整模糊图层', { image_edit: layerRevision }, {
      kind: 'mutation',
      target: effectRef,
      entityType: 'image_edit.layer',
      expectedRevisions: { image_edit: layerRevision },
      mutations: [
        { propertyId: 'image_edit.layer.name', operation: 'set', value: '背景模糊' },
        { propertyId: 'image_edit.layer.opacity', operation: 'set', value: 0.6 },
        { propertyId: 'image_edit.layer.params', operation: 'set', value: { radius: 24 } },
      ],
    }, 'layer-a')
    expect(changed.status, JSON.stringify(changed)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({
      id: effect.id,
      name: '背景模糊',
      opacity: 0.6,
      params: { radius: 24 },
    })

    if (changed.status !== 'completed' || !changed.undoRef) throw new Error('LAYER_UNDO_REF_MISSING')
    const layerUndone = await getApplicationControlExecutionEngine().undo({
      undoRef: changed.undoRef,
      expectedRevisions: changed.resultingRevisions,
      idempotencyKey: 'image-edit-v3-layer-a-undo',
    }, executionContext)
    expect(layerUndone.status, JSON.stringify(layerUndone)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({
      name: '模糊',
      opacity: 1,
      params: { radius: 8 },
    })

    const maskRef = imageEditV3MaskRef(document.id, raster.id)
    const maskSnapshot = await registry.readEntity(maskRef, undefined, accessContext)
    expect(maskSnapshot.properties['image_edit.mask.resource_refs']).toEqual([
      imageEditV3ResourceRef(document.id, 'sha256:mask-tile-a'),
      imageEditV3ResourceRef(document.id, 'sha256:mask-tile-b'),
    ])
    const maskRevision = maskSnapshot.revisions.image_edit
    const inverted = await commitStep('反相蒙版', { image_edit: maskRevision }, {
      kind: 'mutation',
      target: maskRef,
      entityType: 'image_edit.mask',
      expectedRevisions: { image_edit: maskRevision },
      mutations: [{ propertyId: 'image_edit.mask.inverted', operation: 'set', value: true }],
    }, 'mask-a')
    expect(inverted.status, JSON.stringify(inverted)).toBe('completed')
    expect(bus.getSnapshot().document.layers[0]?.mask).toMatchObject({
      kind: 'sparse-mask',
      maskId: 'mask-a',
      inverted: true,
      tiles: {
        '0/0/0': 'sha256:mask-tile-a',
        '0/1/0': 'sha256:mask-tile-b',
        '0/2/0': 'sha256:mask-tile-a',
      },
    })

    if (inverted.status !== 'completed' || !inverted.undoRef) throw new Error('MASK_UNDO_REF_MISSING')
    const maskUndone = await getApplicationControlExecutionEngine().undo({
      undoRef: inverted.undoRef,
      expectedRevisions: inverted.resultingRevisions,
      idempotencyKey: 'image-edit-v3-mask-a-undo',
    }, executionContext)
    expect(maskUndone.status, JSON.stringify(maskUndone)).toBe('completed')
    expect(bus.getSnapshot().document.layers[0]?.mask?.inverted).toBe(false)

    bus.dispatch({
      commandId: 'test-lock-effect-a',
      expectedRevision: bus.getSnapshot().document.revision,
      type: 'layer.update-common',
      layerId: effect.id,
      patch: { locked: true },
    })
    const lockedAvailability = await registry.getPropertyAvailability(
      effectRef,
      ['image_edit.layer.opacity', 'image_edit.layer.locked'],
      accessContext,
    )
    expect(lockedAvailability).toEqual([
      expect.objectContaining({ propertyId: 'image_edit.layer.opacity', writable: false }),
      expect.objectContaining({ propertyId: 'image_edit.layer.locked', writable: true }),
    ])
  })

  it('通用集合创建删除图层并把 V3 标注别名写回所属标注图层', async () => {
    const document = createImageEditDocumentV3({ width: 640, height: 480, documentId: 'assistant-v3-doc-b' })
    document.layers = [createImageEditAnnotationLayerV3('annotations-b', '标注')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerImageEditV3LiveSession('assistant-v3-session-b', bus))
    const registry = getApplicationReflectionRegistry()
    const documentRef = imageEditV3DocumentRef(document.id)

    const initial = await registry.readEntity(documentRef, undefined, accessContext)
    const createdGroup = await commitStep('新建图层组', initial.revisions, {
      kind: 'collection',
      parent: documentRef,
      entityType: 'image_edit.group',
      expectedRevisions: initial.revisions,
      operation: {
        kind: 'create',
        items: [{ properties: { 'image_edit.group.name': '效果组', 'image_edit.group.isolated': true } }],
      },
    }, 'group-b')
    expect(createdGroup.status, JSON.stringify(createdGroup)).toBe('completed')
    if (createdGroup.status !== 'completed') throw new Error('GROUP_CREATE_FAILED')
    const groupRef = createdGroup.resultRefs[0]
    expect(groupRef.kind).toBe('image_edit.group')
    expect(createdGroup.effects).toEqual([
      expect.objectContaining({ effect: 'create', entityType: 'image_edit.group' }),
    ])
    const { layerId: groupId } = splitImageEditV3LayerRef(groupRef, 'image_edit.group')

    const groupSnapshot = await registry.readEntity(groupRef, undefined, accessContext)
    const createdEffect = await commitStep('在组内新建曝光调整', groupSnapshot.revisions, {
      kind: 'collection',
      parent: groupRef,
      entityType: 'image_edit.layer',
      expectedRevisions: groupSnapshot.revisions,
      operation: {
        kind: 'create',
        items: [{ properties: {
          'image_edit.layer.name': '曝光',
          'image_edit.layer.type': 'adjustment',
          'image_edit.layer.definition_id': 'exposure',
          'image_edit.layer.params': { stops: 1, offset: 0, gamma: 1 },
        } }],
      },
    }, 'effect-b')
    expect(createdEffect.status, JSON.stringify(createdEffect)).toBe('completed')
    if (createdEffect.status !== 'completed') throw new Error('EFFECT_CREATE_FAILED')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({
      id: groupId,
      type: 'group',
      children: [expect.objectContaining({ type: 'adjustment', adjustmentId: 'exposure' })],
    })

    const effectRef = createdEffect.resultRefs[0]
    const beforeMove = await registry.readEntity(effectRef, undefined, accessContext)
    const movedEffect = await commitStep('把曝光调整移到根级最下方', beforeMove.revisions, {
      kind: 'mutation',
      target: effectRef,
      entityType: 'image_edit.layer',
      expectedRevisions: beforeMove.revisions,
      mutations: [
        { propertyId: 'image_edit.layer.parent_ref', operation: 'set', value: documentRef },
        { propertyId: 'image_edit.layer.index', operation: 'set', value: 0 },
      ],
    }, 'move-effect-b')
    expect(movedEffect.status, JSON.stringify(movedEffect)).toBe('completed')
    expect(bus.getSnapshot().document.layers).toEqual([
      expect.objectContaining({ type: 'adjustment', adjustmentId: 'exposure' }),
      expect.objectContaining({ id: 'annotations-b' }),
      expect.objectContaining({ id: groupId, type: 'group', children: [] }),
    ])
    if (movedEffect.status !== 'completed' || !movedEffect.undoRef) throw new Error('MOVE_UNDO_REF_MISSING')
    const moveUndone = await getApplicationControlExecutionEngine().undo({
      undoRef: movedEffect.undoRef,
      expectedRevisions: movedEffect.resultingRevisions,
      idempotencyKey: 'image-edit-v3-move-effect-b-undo',
    }, executionContext)
    expect(moveUndone.status, JSON.stringify(moveUndone)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({
      id: groupId,
      type: 'group',
      children: [expect.objectContaining({ type: 'adjustment', adjustmentId: 'exposure' })],
    })

    const annotationLayerRef = imageEditV3LayerRef(document.id, 'annotations-b')
    const markRevision = imageMarkRevision()
    const createdAnnotation = await commitStep('在 V3 标注图层添加矩形', { image_mark: markRevision }, {
      kind: 'collection',
      parent: annotationLayerRef,
      entityType: 'image_mark.annotation',
      expectedRevisions: { image_mark: markRevision },
      operation: {
        kind: 'create',
        items: [{ properties: {
          'image_mark.annotation.type': 'rect',
          'image_mark.annotation.data': {
            x: 10, y: 12, width: 80, height: 50, stroke: 'red', lineWidth: 2,
          },
        } }],
      },
    }, 'annotation-b')
    expect(createdAnnotation.status, JSON.stringify(createdAnnotation)).toBe('completed')
    if (createdAnnotation.status !== 'completed') throw new Error('ANNOTATION_CREATE_FAILED')
    const annotationRef = createdAnnotation.resultRefs[0]
    if (!annotationRef) throw new Error('ANNOTATION_REF_MISSING')
    expect(annotationRef?.id).toContain('v3:assistant-v3-doc-b:annotations-b:')
    expect(createdAnnotation.effects).toEqual([
      expect.objectContaining({ effect: 'create', entityType: 'image_mark.annotation' }),
    ])
    expect((bus.getSnapshot().document.layers[0] as { annotations?: unknown[] }).annotations).toHaveLength(1)

    const annotationSnapshot = await registry.readEntity(annotationRef, undefined, accessContext)
    const updatedAnnotation = await commitStep('修改 V3 矩形标注', annotationSnapshot.revisions, {
      kind: 'mutation',
      target: annotationRef,
      entityType: 'image_mark.annotation',
      expectedRevisions: annotationSnapshot.revisions,
      mutations: [{
        propertyId: 'image_mark.annotation.data',
        operation: 'set',
        value: { x: 20, y: 24, width: 96, height: 64, stroke: 'blue', lineWidth: 3 },
      }],
    }, 'update-annotation-b')
    expect(updatedAnnotation.status, JSON.stringify(updatedAnnotation)).toBe('completed')
    expect(updatedAnnotation.status === 'completed' ? updatedAnnotation.effects : []).toEqual([
      expect.objectContaining({
        effect: 'update',
        entityType: 'image_mark.annotation',
        propertyIds: ['image_mark.annotation.data'],
      }),
    ])
    expect((bus.getSnapshot().document.layers[0] as {
      annotations?: Array<{ x?: number; stroke?: string }>
    }).annotations?.[0]).toMatchObject({ x: 20, stroke: 'blue' })

    const beforeAnnotationRemove = await registry.readEntity(annotationRef, undefined, accessContext)
    const removedAnnotation = await commitStep('删除 V3 矩形标注', beforeAnnotationRemove.revisions, {
      kind: 'collection',
      parent: annotationLayerRef,
      entityType: 'image_mark.annotation',
      expectedRevisions: beforeAnnotationRemove.revisions,
      operation: { kind: 'remove', targets: [annotationRef] },
    }, 'remove-annotation-b')
    expect(removedAnnotation.status, JSON.stringify(removedAnnotation)).toBe('completed')
    expect(removedAnnotation.status === 'completed' ? removedAnnotation.effects : []).toEqual([
      expect.objectContaining({ effect: 'delete', entityType: 'image_mark.annotation' }),
    ])
    expect((bus.getSnapshot().document.layers[0] as { annotations?: unknown[] }).annotations).toHaveLength(0)

    const beforeRemove = await registry.readEntity(effectRef, undefined, accessContext)
    const removedEffect = await commitStep('删除组内曝光调整', beforeRemove.revisions, {
      kind: 'collection',
      parent: imageEditV3GroupRef(document.id, groupId),
      entityType: 'image_edit.layer',
      expectedRevisions: beforeRemove.revisions,
      operation: { kind: 'remove', targets: [effectRef] },
    }, 'remove-effect-b')
    expect(removedEffect.status, JSON.stringify(removedEffect)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({ type: 'group', children: [] })

    const beforeGroupLock = await registry.readEntity(groupRef, undefined, accessContext)
    const lockedGroup = await commitStep('锁定 V3 图层组', beforeGroupLock.revisions, {
      kind: 'mutation',
      target: groupRef,
      entityType: 'image_edit.group',
      expectedRevisions: beforeGroupLock.revisions,
      mutations: [{ propertyId: 'image_edit.group.locked', operation: 'set', value: true }],
    }, 'lock-group-b')
    expect(lockedGroup.status, JSON.stringify(lockedGroup)).toBe('completed')
    const lockedCollection = await registry.getCollectionAvailability(
      groupRef,
      'image_edit.layer',
      accessContext,
    )
    expect(lockedCollection.create).toMatchObject({ available: false })
    expect(lockedCollection.remove).toMatchObject({ available: false })
  })
})
