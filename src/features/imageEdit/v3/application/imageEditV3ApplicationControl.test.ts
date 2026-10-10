import { BLACK_HEX } from '@/core/theme/colorTokens'
import { rectanglePath } from '@/core/imaging/vectorContent'
import { attachImageEditVectorMaskV3 } from '../tools/vector/service'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'

import type { ApplicationControlAccessContext, ApplicationExecutionContext, JsonValue } from '@/core/application-control'
import {
  createImageEditPathLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { imageEditV3DocumentRef, imageEditV3GroupRef, imageEditV3LayerRef, imageEditV3MaskRef, imageEditV3ResourceRef, splitImageEditV3LayerRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from '@/features/application-control/capabilities/applicationControlRegistry'

import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { ImageEditV3DocumentMutationExecutor } from './imageEditV3MutationExecutors'

const accessContext: ApplicationControlAccessContext = {
  exposure: 'assistant',
  permissions: new Set(['image_edit:read', 'image_edit:write']),
  acceptedDataClasses: new Set(['C0', 'C1']),
}

const executionContext: ApplicationExecutionContext = {
  ...accessContext,
  requestId: 'image-edit-v3-application-control-test',
}

const disposers: Array<() => void> = []

beforeEach(installHarnessNativeStorage)
it('画布锚点走通用文档属性、当前选区同一次撤销，节点持久化入口不分叉', async () => {
  const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'size-reflection' });
  document.layers = [createImageEditRasterLayerV3('content', '内容')];
  const bus = new ImageEditCommandBusV3(document);
  disposers.push(registerPersistedImageEditTestSession('size-reflection-session', bus));
  const reflection = getApplicationReflectionRegistry(), target = imageEditV3DocumentRef(document.id), id = 'image_edit.document.canvas_size';
  const descriptor = reflection.describe({ entityTypes: ['image_edit.document'] }, accessContext).properties.find(value => value.id === id)!;
  if (descriptor.value.kind !== 'json') throw new Error('画布尺寸需公开结构化 schema');
  expect(reflection.resolveSchema(descriptor.value.schemaRef, accessContext)).toMatchObject({ properties: { anchor: { enum: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] } } });
  const before = await reflection.readEntity(target, [id], accessContext);
  expect(before.properties[id]).toEqual({ width: 32, height: 24, anchor: 'center' });
  const result = await commitStep('左上补边', before.revisions, { kind: 'mutation', target, entityType: 'image_edit.document', expectedRevisions: before.revisions,
    mutations: [{ propertyId: id, operation: 'set', value: { width: 48, height: 40, anchor: 'bottom-right' } }] }, 'size');
  expect(result.status, JSON.stringify(result)).toBe('completed');
  expect(bus.getSnapshot().document.layers[0].transform).toEqual([1, 0, 0, 1, 16, 16]);
  expect((await reflection.readEntity(target, [id], accessContext)).properties[id]).toEqual({ width: 48, height: 40, anchor: 'center' });
  if (result.status !== 'completed' || !result.undoRef) throw new Error('缺少尺寸撤销引用');
  const undone = await getApplicationControlExecutionEngine().undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: 'size-transaction-undo' }, executionContext);
  expect(undone.status, JSON.stringify(undone)).toBe('completed');
  expect(bus.getSnapshot().document.geometry).toEqual(document.geometry);
  expect(bus.getSnapshot().document.layers).toEqual(document.layers);
});
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  uninstallHarnessNativeStorage()
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
  it('可编辑路径蒙版经同一坐标契约附着、公开 schema 读写并整体撤销', async () => {
    const document = createImageEditDocumentV3({ width:100,height:100,documentId:'vector-mask-control' })
    const target = createImageEditRasterLayerV3('target','目标')
    target.transform = [2,0,0,2,5,6]; target.maskAttachment.linked = false
    const path = createImageEditPathLayerV3('path','源路径')
    path.transform = [1,0,0,1,10,20]
    const group = createImageEditGroupLayerV3('group','源组'); group.transform = [1,0,0,1,3,4]; group.children = [path]
    document.layers = [target,group]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('vector-mask-control-session',bus))
    attachImageEditVectorMaskV3(document.id,path.id,target.id)
    expect(bus.getSnapshot().document.layers[0].mask?.vectorPaths?.[0].path.commands[0]).toEqual({kind:'move',x:13,y:24})
    const registry = getApplicationReflectionRegistry(), ref = imageEditV3MaskRef(document.id,target.id)
    const description = registry.describe({entityTypes:['image_edit.mask']},accessContext)
    const descriptor = description.properties.find(property=>property.id==='image_edit.mask.vector_paths')!
    expect(descriptor.value.kind).toBe('json')
    const before = await registry.readEntity(ref,['image_edit.mask.vector_paths'],accessContext)
    const paths = [{operation:'replace',path:rectanglePath(20,10,30,40)}]
    const updated = await commitStep('调整可编辑路径蒙版',before.revisions,{kind:'mutation',target:ref,entityType:'image_edit.mask',expectedRevisions:before.revisions,mutations:[{propertyId:descriptor.id,operation:'set',value:JSON.parse(JSON.stringify(paths)) as JsonValue}]},'vector-mask-control')
    expect(updated.status,JSON.stringify(updated)).toBe('completed')
    expect((await registry.readEntity(ref,[descriptor.id],accessContext)).properties[descriptor.id]).toEqual(paths)
    if(updated.status!=='completed'||!updated.undoRef)throw new Error('缺少矢量蒙版撤销引用')
    await getApplicationControlExecutionEngine().undo({undoRef:updated.undoRef,expectedRevisions:updated.resultingRevisions,idempotencyKey:'vector-mask-control-undo'},executionContext)
    expect(bus.getSnapshot().document.layers[0].mask?.vectorPaths?.[0].path.commands[0]).toEqual({kind:'move',x:13,y:24})
  })
  it('智能对象沿通用图层属性转换、读回与撤销，智能内容 schema 可发现', async () => {
    const document = createImageEditDocumentV3({ width: 16, height: 16, documentId: 'smart-reflection' })
    document.layers = [createImageEditRasterLayerV3('content', '内容')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('smart-reflection-session', bus))
    const reflection = getApplicationReflectionRegistry(), target = imageEditV3LayerRef(document.id, 'content')
    const propertyIds = ['image_edit.layer.type', 'image_edit.layer.smart_content', 'image_edit.layer.smart_source']
    const before = await reflection.readEntity(target, propertyIds, accessContext)
    const converted = await commitStep('转换为智能对象', before.revisions, { kind: 'mutation', target, entityType: 'image_edit.layer', expectedRevisions: before.revisions,
      mutations: [{ propertyId: propertyIds[0], operation: 'set', value: 'smart' }] }, 'smart-convert')
    expect(converted.status, JSON.stringify(converted)).toBe('completed')
    const current = await reflection.readEntity(target, propertyIds, accessContext)
    expect(current.properties[propertyIds[0]]).toBe('smart')
    expect(current.properties[propertyIds[1]]).toMatchObject({ version: document.version, layers: [{ type: 'raster' }] })
    const field = reflection.describe({ entityTypes: ['image_edit.layer'] }, accessContext).properties.find(property => property.id === propertyIds[1])!
    if (field.value.kind === 'json') expect(reflection.resolveSchema(field.value.schemaRef, accessContext)).toBeTruthy()
    if (converted.status !== 'completed' || !converted.undoRef) throw new Error('缺少智能对象事务撤销引用')
    expect((await getApplicationControlExecutionEngine().undo({ undoRef: converted.undoRef, expectedRevisions: current.revisions, idempotencyKey: 'smart-convert-undo' }, executionContext)).status).toBe('completed')
    expect(bus.getSnapshot().document.layers).toEqual(document.layers)
  })
  it('命名区域和批量树位置经正式描述、通用写入和读回，支持事务撤销', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'workflow-reflection' })
    document.layers = [createImageEditRasterLayerV3('content', '内容'), createImageEditGroupLayerV3('group', '组')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('workflow-reflection-session', bus))
    const reflection = getApplicationReflectionRegistry(), target = imageEditV3DocumentRef(document.id)
    const regions = [{ id: 'named', name: '主体', selection: { operations: [{ combine: 'replace', invertBefore: false, shape: { type: 'rectangle', x: .1, y: .2, width: .5, height: .3 } }], feather: .02, inverted: false } }]
    const ids = ['image_edit.document.named_regions', 'image_edit.document.layer_order']
    const descriptors = reflection.describe({ entityTypes: ['image_edit.document'] }, accessContext).properties
    for (const id of ids) {
      const field = descriptors.find(entry => entry.id === id)
      expect(field?.readOnlyReason).toBeUndefined()
      expect(field).toBeDefined()
      if (field?.value.kind === 'json') expect(reflection.resolveSchema(field.value.schemaRef, accessContext)).toBeTruthy()
    }
    const before = await reflection.readEntity(target, ids, accessContext)
    const result = await commitStep('保存主体并移入组', before.revisions, { kind: 'mutation', target, entityType: 'image_edit.document', expectedRevisions: before.revisions,
      mutations: [{ propertyId: ids[0], operation: 'set', value: regions }, { propertyId: ids[1], operation: 'set', value: [{ layerId: 'content', parentId: 'group', index: 0 }] }] }, 'workflow')
    expect(result.status, JSON.stringify(result)).toBe('completed')
    const read = await reflection.readEntity(target, ids, accessContext)
    expect(read.properties[ids[0]]).toEqual(regions)
    expect(read.properties[ids[1]]).toEqual([{ layerId: 'group', parentId: null, index: 0 }, { layerId: 'content', parentId: 'group', index: 0 }])
    if (result.status !== 'completed' || !result.undoRef) throw new Error('缺少工作流事务撤销引用')
    const undone = await getApplicationControlExecutionEngine().undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: 'workflow-transaction-undo' }, executionContext)
    expect(undone.status, JSON.stringify(undone)).toBe('completed')
    expect(bus.getSnapshot().document.layers).toEqual(document.layers)
    expect(bus.getSnapshot().document.namedRegions).toEqual([])
  })

  it('多步历史导航失败时逆序补偿游标，混合新编辑在写入前拒绝', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'history-compensation' })
    document.layers = [createImageEditRasterLayerV3('content', '内容')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('history-compensation-session', bus))
    for (let index = 0; index < 3; index++) bus.dispatch({ type: 'layer.update-common', layerId: 'content',
      commandId: `compensate-name-${index}`, expectedRevision: bus.getSnapshot().document.revision, patch: { name: `编辑 ${index}` } })
    const executor = new ImageEditV3DocumentMutationExecutor()
    const target = imageEditV3DocumentRef(document.id)
    const step = (value: number) => ({ kind: 'mutation' as const, target, entityType: 'image_edit.document', expectedRevisions: {},
      mutations: [{ propertyId: 'image_edit.document.history_position', operation: 'set' as const, value }] })
    await expect(executor.applyAtomic([step(1), step(2), step(999)], executionContext)).rejects.toThrow('0～3')
    expect(bus.getHistoryView()).toMatchObject({ position: 3, total: 3 })
    expect(bus.getSnapshot().document.layers[0].name).toBe('编辑 2')
    const before = bus.getSnapshot().document
    await expect(executor.applyAtomic([step(1), { ...step(1), mutations: [{ propertyId: 'image_edit.document.orientation', operation: 'set', value: { rotate: 90, mirrored: false } }] }], executionContext)).rejects.toThrow('独立事务')
    expect(bus.getSnapshot().document).toBe(before)
  })
  it('历史位置经正式描述、权限、通用属性写入、读回与撤销，不新增恢复工具', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'history-reflection' })
    document.layers = [createImageEditRasterLayerV3('content', '内容')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('history-reflection-session', bus))
    for (let index = 0; index < 3; index++) bus.dispatch({ type: 'layer.update-common', layerId: 'content',
      commandId: `history-name-${index}`, expectedRevision: bus.getSnapshot().document.revision, patch: { name: `编辑 ${index}` } })
    const reflection = getApplicationReflectionRegistry()
    const target = imageEditV3DocumentRef(document.id)
    const propertyId = 'image_edit.document.history_position'
    const described = reflection.describe({ entityTypes: ['image_edit.document'] }, accessContext)
    expect(described.properties.find(field => field.id === propertyId)?.readOnlyReason).toBeUndefined()
    const before = await reflection.readEntity(target, [propertyId, 'image_edit.document.history_entries'], accessContext)
    expect(before.properties[propertyId]).toBe(3)
    expect(before.properties['image_edit.document.history_entries']).toHaveLength(4)
    const result = await commitStep('恢复第一处编辑', before.revisions, { kind: 'mutation', target,
      entityType: 'image_edit.document', expectedRevisions: before.revisions,
      mutations: [{ propertyId, operation: 'set', value: 1 }] }, 'history-position')
    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect((await reflection.readEntity(target, [propertyId], accessContext)).properties[propertyId]).toBe(1)
    expect(bus.getSnapshot().document.layers[0].name).toBe('编辑 0')
    if (result.status !== 'completed' || !result.undoRef) throw new Error('缺少历史恢复撤销引用')
    const undone = await getApplicationControlExecutionEngine().undo({ undoRef: result.undoRef,
      expectedRevisions: result.resultingRevisions, idempotencyKey: 'history-position-undo' }, executionContext)
    expect(undone.status, JSON.stringify(undone)).toBe('completed')
    expect(bus.getHistoryView()).toMatchObject({ position: 3, total: 3 })
    expect((await reflection.readEntity(target, [propertyId], { ...accessContext, permissions: new Set() })).properties).toEqual({})
  })
  it('滤镜子集合经正式事务增删、参数和开关排序读回、持久历史及撤销', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'filter-entities' })
    document.layers = [createImageEditRasterLayerV3('content', '内容')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('filter-entities-session', bus))
    const reflection = getApplicationReflectionRegistry()
    const parent = imageEditV3LayerRef(document.id, 'content')
    const fields = reflection.describe({ entityTypes: ['image_edit.layer', 'image_edit.group', 'image_edit.layer_filter'] }, accessContext).properties
    for (const field of fields) if (field.value.kind === 'json') {
      expect(reflection.resolveSchema(field.value.schemaRef, accessContext)).toBeTruthy()
      expect(() => reflection.resolveSchema(field.value.kind === 'json' ? field.value.schemaRef : field.schemaRef,
        { ...accessContext, permissions: new Set() })).toThrow('PERMISSION_DENIED')
    }
    const before = await reflection.readEntity(parent, undefined, accessContext)
    const created = await commitStep('添加两个图层滤镜', before.revisions, { kind: 'collection', parent,
      entityType: 'image_edit.layer_filter', expectedRevisions: before.revisions,
      operation: { kind: 'create', items: [0.4, 0.6].map(stops => ({ properties: {
        'image_edit.layer_filter.operation_type': 'adjustment', 'image_edit.layer_filter.effect_id': 'exposure',
        'image_edit.layer_filter.params': { stops },
      } })) } }, 'filter-create')
    expect(created.status, JSON.stringify(created)).toBe('completed')
    const listed = await reflection.listEntities('image_edit.layer_filter', { limit: 10 }, accessContext)
    expect(listed.refs).toHaveLength(2)
    const target = listed.refs[0]
    const first = await reflection.readEntity(target, undefined, accessContext)
    const changed = await commitStep('关闭并移动滤镜', first.revisions, { kind: 'mutation', target,
      entityType: 'image_edit.layer_filter', expectedRevisions: first.revisions, mutations: [
        { propertyId: 'image_edit.layer_filter.enabled', operation: 'set', value: false },
        { propertyId: 'image_edit.layer_filter.index', operation: 'set', value: 1 },
        { propertyId: 'image_edit.layer_filter.params', operation: 'set', value: { stops: 1.2 } },
        { propertyId: 'image_edit.layer_filter.mask', operation: 'set', value: createImageEditSparseMaskReferenceV3('empty-region', false, 0) as unknown as JsonValue },
      ] }, 'filter-change')
    expect(changed.status, JSON.stringify(changed)).toBe('completed')
    expect((await reflection.readEntity(target, undefined, accessContext)).properties).toMatchObject({
      'image_edit.layer_filter.enabled': false, 'image_edit.layer_filter.index': 1, 'image_edit.layer_filter.params': { stops: 1.2 },
    })
    const saved = bus.getPersistenceSnapshot()
    const restored = new ImageEditCommandBusV3(saved.document, { historySnapshot: saved.history })
    expect(restored.undo()).toBe(true)
    expect(restored.getSnapshot().document.layers[0].filters[0]).toMatchObject({ enabled: true, params: { stops: 0.4 }, mask: null })
    expect(restored.redo()).toBe(true)
    expect(restored.getSnapshot().document.layers[0].filters[1].enabled).toBe(false)
    restored.dispose()
    const read = await reflection.readEntity(parent, undefined, accessContext)
    const removed = await commitStep('删除图层滤镜', read.revisions, { kind: 'collection', parent,
      entityType: 'image_edit.layer_filter', expectedRevisions: read.revisions, operation: { kind: 'remove', targets: [target] } }, 'filter-remove')
    expect(removed.status, JSON.stringify(removed)).toBe('completed')
    await expect(reflection.readEntity(target, undefined, accessContext)).rejects.toThrow('NOT_FOUND')
    if (removed.status !== 'completed' || !removed.undoRef) throw new Error('滤镜删除缺少撤销引用')
    const undone = await getApplicationControlExecutionEngine().undo({ undoRef: removed.undoRef,
      expectedRevisions: removed.resultingRevisions, idempotencyKey: 'filter-remove-undo' }, executionContext)
    expect(undone.status, JSON.stringify(undone)).toBe('completed')
    expect((await reflection.readEntity(target, undefined, accessContext)).properties['image_edit.layer_filter.enabled']).toBe(false)
  })
  it('共同字段经通用事务原子改写、读回并撤销', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'common-fields' })
    const base = createImageEditRasterLayerV3('base', '基底')
    const content = createImageEditRasterLayerV3('content', '内容')
    document.layers = [base, content]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('common-fields-session', bus))
    const reflection = getApplicationReflectionRegistry()
    const target = imageEditV3LayerRef(document.id, content.id)
    const before = await reflection.readEntity(target, undefined, accessContext)
    const filters = [{ id: 'local', operationType: 'adjustment', effectId: 'exposure', params: { stops: .4 }, enabled: true, opacity: .7, blendMode: 'normal', mask: null }]
    const attachment = { enabled: true, linked: false, density: .6, transform: [1, 0, 0, 1, 2, 0] }
    const mutations = [
      { propertyId: 'image_edit.layer.deformation', operation: 'set' as const, value: { kind: 'perspective', points: [[.1,0],[.9,0],[1,1],[0,1]] } },
      { propertyId: 'image_edit.layer.transform', operation: 'set' as const, value: [1,0,0,1,3,2] },
      { propertyId: 'image_edit.layer.fill_opacity', operation: 'set' as const, value: .4 },
      { propertyId: 'image_edit.layer.clipping', operation: 'set' as const, value: true },
      { propertyId: 'image_edit.layer.mask_attachment', operation: 'set' as const, value: attachment },
      { propertyId: 'image_edit.layer.filters', operation: 'set' as const, value: filters },
    ]
    const result = await commitStep('准备局部滤镜剪贴层', before.revisions, {
      kind: 'mutation', target, entityType: 'image_edit.layer', expectedRevisions: before.revisions, mutations,
    }, 'common-fields')
    expect(result.status, JSON.stringify(result)).toBe('completed')
    const readback = await reflection.readEntity(target, undefined, accessContext)
    for (const mutation of mutations) expect(readback.properties[mutation.propertyId]).toEqual(mutation.value)
    if (result.status !== 'completed' || !result.undoRef) throw new Error('缺少共同字段撤销引用')
    const undo = await getApplicationControlExecutionEngine().undo({ undoRef: result.undoRef,
      expectedRevisions: result.resultingRevisions, idempotencyKey: 'common-fields-undo' }, executionContext)
    expect(undo.status, JSON.stringify(undo)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({ fillOpacity: 1, clipping: false, filters: [] })
  })

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
      'gaussian_blur',
      { sigma_fraction_height: 8 },
    )
    effect.mask = { ...createImageEditSparseMaskReferenceV3('sha256:legacy-mask-a', false), tiles: { '0/0/0': 'sha256:legacy-mask-a' } }
    document.layers = [raster, effect]
    const bus = new ImageEditCommandBusV3(document, {
      resourceByteSizes: {
        'sha256:mask-tile-a': 512,
        'sha256:mask-tile-b': 256,
      },
    })
    disposers.push(registerPersistedImageEditTestSession('assistant-v3-session-a', bus))

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
        { propertyId: 'image_edit.layer.params', operation: 'set', value: { sigma_fraction_height: 24 } },
      ],
    }, 'layer-a')
    expect(changed.status, JSON.stringify(changed)).toBe('completed')
    expect(bus.getSnapshot().document.layers[1]).toMatchObject({
      id: effect.id,
      name: '背景模糊',
      opacity: 0.6,
      params: { sigma_fraction_height: 24 },
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
      params: { sigma_fraction_height: 8 },
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

  it('通用集合通过正式命令总线创建新版模糊图层', async () => {
    const document = createImageEditDocumentV3({
      width: 640,
      height: 480,
      documentId: 'assistant-v3-fast-blur',
    })
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('assistant-v3-fast-blur-session', bus))
    const documentRef = imageEditV3DocumentRef(document.id)
    const initial = await getApplicationReflectionRegistry().readEntity(
      documentRef,
      undefined,
      accessContext,
    )

    const created = await commitStep('添加模糊', initial.revisions, {
      kind: 'collection',
      parent: documentRef,
      entityType: 'image_edit.layer',
      expectedRevisions: initial.revisions,
      operation: {
        kind: 'create',
        items: [{ properties: {
          'image_edit.layer.name': '模糊',
          'image_edit.layer.type': 'effect',
          'image_edit.layer.definition_id': 'image.fast-blur-v3',
          'image_edit.layer.params': { radius: 12 },
        } }],
      },
    }, 'create-fast-blur')

    expect(created.status, JSON.stringify(created)).toBe('completed')
    expect(bus.getSnapshot().document.layers).toEqual([
      expect.objectContaining({
        type: 'effect',
        effectId: 'image.fast-blur-v3',
        params: { radius: 12 },
      }),
    ])
  })

  it('通用集合通过正式命令总线创建共享调整层并通过 params 读写', async () => {
    const document = createImageEditDocumentV3({
      width: 640,
      height: 480,
      documentId: 'assistant-v3-shared-grade',
    })
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('assistant-v3-shared-grade-session', bus))
    const documentRef = imageEditV3DocumentRef(document.id)
    const initial = await getApplicationReflectionRegistry().readEntity(
      documentRef,
      undefined,
      accessContext,
    )

    const created = await commitStep('添加调整', initial.revisions, {
      kind: 'collection',
      parent: documentRef,
      entityType: 'image_edit.layer',
      expectedRevisions: initial.revisions,
      operation: {
        kind: 'create',
        items: [{ properties: {
          'image_edit.layer.name': '调整',
          'image_edit.layer.type': 'adjustment',
          'image_edit.layer.definition_id': 'color_grade',
          'image_edit.layer.params': { exposure: .5 },
        } }],
      },
    }, 'create-shared-grade')

    expect(created.status, JSON.stringify(created)).toBe('completed')
    expect(bus.getSnapshot().document.layers).toEqual([
      expect.objectContaining({
        type: 'adjustment',
        adjustmentId: 'color_grade',
        params: expect.objectContaining({ exposure: .5 }),
      }),
    ])
    const layer = bus.getSnapshot().document.layers[0]
    const ref = imageEditV3LayerRef(document.id, layer.id)
    const snapshot = await getApplicationReflectionRegistry().readEntity(ref, undefined, accessContext)
    expect(snapshot.properties['image_edit.layer.params']).toMatchObject({ exposure: .5 })
    const changed = await commitStep('修改曝光', snapshot.revisions, { kind: 'mutation', entityType: 'image_edit.layer', target: ref, expectedRevisions: snapshot.revisions, mutations: [{ propertyId: 'image_edit.layer.params', operation: 'set', value: { exposure: 1 } }] }, 'shared-grade-write')
    expect(changed.status, JSON.stringify(changed)).toBe('completed')
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({ params: { exposure: 1 } })
    bus.undo()
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({ params: { exposure: .5 } })
  })

  it('通用集合创建删除图层并把 V3 标注别名写回所属标注图层', async () => {
    const document = createImageEditDocumentV3({ width: 640, height: 480, documentId: 'assistant-v3-doc-b' })
    document.layers = [createImageEditPathLayerV3('annotations-b', '标注')]
    const bus = new ImageEditCommandBusV3(document)
    disposers.push(registerPersistedImageEditTestSession('assistant-v3-session-b', bus))
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

    const vectorRef=imageEditV3LayerRef(document.id,'annotations-b')
    const vectorSnapshot=await registry.readEntity(vectorRef,undefined,accessContext)
    const content=createImageEditPathLayerV3('unused','形状').content
    content.paint.fill={enabled:true,color:BLACK_HEX}
    const updatedVector=await commitStep('修改矢量图层内容',vectorSnapshot.revisions,{
      kind:'mutation',target:vectorRef,entityType:'image_edit.layer',expectedRevisions:vectorSnapshot.revisions,
      mutations:[{propertyId:'image_edit.layer.content',operation:'set',value:content as unknown as import('@/core/application-control').JsonValue}],
    },'vector-b')
    expect(updatedVector.status,JSON.stringify(updatedVector)).toBe('completed')
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({type:'shape',content:{paint:{fill:{color:BLACK_HEX}}}})

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
