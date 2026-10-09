import { z } from 'zod'
import {
  applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, propertyOperations,
  unrestrictedCollectionAvailability, writableProperties,
  type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationEntityListRequest,
  type ApplicationEntityRegistration, type ApplicationExecutionContext, type ApplicationPlannedStep,
  type ApplicationRef, type JsonValue,
} from '@/core/application-control'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { imageEditLayerFilterSchemaV3, imageEditLayerFiltersSchemaV3 } from '@/core/imageEdit/v3/layerModel/semantics'
import { IMAGE_EDIT_V3_FILTER_FIELDS, imageEditV3SchemaRef, type ImageEditV3FilterMutationDraft } from './imageEditV3Fields'
import { ImageEditV3LayerMutationExecutor, ImageEditV3GroupMutationExecutor, ImageEditV3MutationExecutorBase } from './imageEditV3MutationExecutors'
import { collectImageEditV3LiveLayers, findImageEditV3LiveLayer, imageEditV3FilterRef, imageEditV3GroupRef, imageEditV3LayerRef, splitImageEditV3FilterRef, splitImageEditV3LayerRef } from './imageEditDocumentRefs'
import { listImageEditDocumentEntitiesV3 } from './imageEditDocumentCatalog'
import { ensureImageEditRefInstanceV3 } from './imageEditDocumentLoading'
import { getImageEditDocumentCatalogRevisionV3, requireImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { imageEditPersistenceAvailabilityV3, imageEditPersistencePermissionsV3, imageEditPersistenceRevisionsV3, runImageEditPersistedOperationV3 } from './imageEditPersistenceOperations'

const ENTITY = 'image_edit.layer_filter'
const COLLECTION_UNDO_PREFIX = 'image-edit-filter-collection:'
function collectionUndo(token: string) {
  if (!token.startsWith(COLLECTION_UNDO_PREFIX)) throw new Error('IMAGE_EDIT_FILTER_UNDO_INVALID')
  return z.object({ delegate: z.string(), refs: z.array(z.object({ kind: z.literal(ENTITY), id: z.string() }).passthrough()) }).parse(JSON.parse(token.slice(COLLECTION_UNDO_PREFIX.length)))
}
type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
const writers = fieldWriterTable(IMAGE_EDIT_V3_FILTER_FIELDS)

function source(ref: ApplicationRef) {
  const { documentId, layerId, filterId } = splitImageEditV3FilterRef(ref)
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
  const index = location?.layer.filters.findIndex(filter => filter.id === filterId) ?? -1
  if (!location || index < 0) throw new Error('NOT_FOUND：图层滤镜不存在')
  return { documentId, location, filter: location.layer.filters[index], index }
}

function parentSource(ref: ApplicationRef) {
  if (ref.kind !== 'image_edit.layer' && ref.kind !== 'image_edit.group') throw new Error('NOT_FOUND：滤镜父级必须是图层或组')
  const { documentId, layerId } = splitImageEditV3LayerRef(ref, ref.kind)
  const { bus } = requireImageEditDocumentInstanceV3(documentId)
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
  if (!location || (location.layer.type === 'group') !== (ref.kind === 'image_edit.group')) throw new Error('NOT_FOUND')
  return { documentId, location }
}

class FilterProvider {
  readonly entityType = ENTITY
  async listEntities(request: ApplicationEntityListRequest) {
    return listImageEditDocumentEntitiesV3(request, document => collectImageEditV3LiveLayers(document)
      .flatMap(({ layer }) => layer.filters.map(filter => imageEditV3FilterRef(document.id, layer.id, filter.id))))
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    await ensureImageEditRefInstanceV3(ref)
    const values = fieldReadValues(IMAGE_EDIT_V3_FILTER_FIELDS, source(ref))
    return { ref, entityType: ENTITY,
      revisions: { image_edit: getImageEditDocumentCatalogRevisionV3(), ...imageEditPersistenceRevisionsV3(ref) },
      properties: request.propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id))) : values,
      capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    await ensureImageEditRefInstanceV3(ref)
    const owner = source(ref)
    const availability = await this.getCollectionAvailability(owner.location.layer.type === 'group' ? imageEditV3GroupRef(owner.documentId, owner.location.layer.id) : imageEditV3LayerRef(owner.documentId, owner.location.layer.id))
    return propertyIds.map(propertyId => {
      const descriptor = IMAGE_EDIT_V3_FILTER_FIELDS.find(field => field.propertyId === propertyId)?.descriptor
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const writable = !descriptor.readOnlyReason && availability.create.available
      return { propertyId, readable: true, writable,
        reasons: descriptor.readOnlyReason ? [descriptor.readOnlyReason] : availability.create.reasons,
        requiredPermissions: writable ? ['image_edit:write', ...imageEditPersistencePermissionsV3(ref)] : ['image_edit:read'],
        revisions: availability.revisions }
    })
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    await ensureImageEditRefInstanceV3(parent)
    const { documentId, location } = parentSource(parent)
    const availability = imageEditPersistenceAvailabilityV3(documentId, unrestrictedCollectionAvailability(ENTITY, parent,
      { image_edit: getImageEditDocumentCatalogRevisionV3(), ...imageEditPersistenceRevisionsV3(parent) }, ['image_edit:write']))
    const reason = location.layer.type === 'effect' || location.layer.type === 'adjustment'
      ? '滤镜列表仅挂在内容图层或图层组上；作用下方内容请直接修改滤镜图层参数'
      : location.layer.locked || location.ancestors.some(layer => layer.locked) ? '请先解锁图层及其父组' : null
    if (!reason) return availability
    const block = { kind: 'state' as const, requirementId: 'image_edit.layer_filter.editable_content', affectedEntityTypes: [ENTITY], revisionScopes: ['image_edit'] }
    return { ...availability, create: { ...availability.create, available: false, reasons: [reason], blocks: [block] }, remove: { ...availability.remove, available: false, reasons: [reason], blocks: [block] } }
  }
}

export class ImageEditLayerFilterMutationExecutorV3 extends ImageEditV3MutationExecutorBase {
  readonly entityType = ENTITY
  readonly writableProperties = writableProperties(writers)
  readonly propertyOperations = propertyOperations(writers)
  async createCommands(step: MutationStep) {
    const current = source(step.target)
    const draft: ImageEditV3FilterMutationDraft = { filter: structuredClone(current.filter), index: current.index }
    await applyWriterTable(writers, draft, step.mutations)
    const filters = structuredClone(current.location.layer.filters)
    if (draft.index >= filters.length) throw new Error('INVALID_INPUT：滤镜顺序超出当前列表')
    filters.splice(current.index, 1)
    filters.splice(draft.index, 0, imageEditLayerFilterSchemaV3.parse(draft.filter))
    return { documentId: current.documentId, commands: [{ type: 'layer.update-common' as const,
      commandId: createImageEditIdV3('filter-change'), expectedRevision: 0, layerId: current.location.layer.id,
      patch: { filters: imageEditLayerFiltersSchemaV3.parse(filters) } }] }
  }
}

/** 集合编辑只编译为同一层 filters 属性事务，资源、回滚、历史与保存不另写一套。 */
export class ImageEditLayerFilterCollectionExecutorV3 implements ApplicationCollectionExecutor {
  readonly entityType = ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  private delegate(parent: ApplicationRef) { return parent.kind === 'image_edit.group' ? new ImageEditV3GroupMutationExecutor() : new ImageEditV3LayerMutationExecutor() }
  async apply(step: CollectionStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    await ensureImageEditRefInstanceV3(step.parent)
    const { documentId } = parentSource(step.parent)
    return runImageEditPersistedOperationV3(documentId, context, async batchContext => {
      const { location } = parentSource(step.parent)
      const filters = structuredClone(location.layer.filters)
      const refs: ApplicationRef[] = []
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          const get = (suffix: string) => item.properties[`${ENTITY}.${suffix}`]
          const id = createImageEditIdV3('filter')
          const filter = imageEditLayerFilterSchemaV3.parse({ id, operationType: get('operation_type'), effectId: get('effect_id'), params: get('params'),
            enabled: get('enabled') ?? true, opacity: get('opacity') ?? 1, blendMode: get('blend_mode') ?? 'normal', mask: get('mask') ?? null })
          const index = get('index') === undefined ? filters.length : z.number().int().nonnegative().max(filters.length).parse(get('index'))
          filters.splice(index, 0, filter)
          refs.push(imageEditV3FilterRef(documentId, location.layer.id, id))
        }
      } else {
        for (const ref of step.operation.targets) {
          const target = splitImageEditV3FilterRef(ref)
          if (target.documentId !== documentId || target.layerId !== location.layer.id) throw new Error('NOT_FOUND：滤镜不属于指定图层')
          const index = filters.findIndex(filter => filter.id === target.filterId)
          if (index < 0) throw new Error('NOT_FOUND：滤镜不存在或重复删除')
          filters.splice(index, 1); refs.push(ref)
        }
      }
      const result = await this.delegate(step.parent).apply({ kind: 'mutation', target: step.parent, entityType: step.parent.kind,
        expectedRevisions: step.expectedRevisions, mutations: [{ propertyId: `${step.parent.kind}.filters`, operation: 'set', value: filters as unknown as JsonValue }] }, batchContext!)
      if (!result.undoToken) throw new Error('IMAGE_EDIT_FILTER_UNDO_MISSING')
      return { ...result, undoToken: COLLECTION_UNDO_PREFIX + JSON.stringify({ delegate: result.undoToken, refs }), directRefs: refs.map(ref => ({ ...ref, revision: result.resultingRevisions.image_edit })),
        evidence: [{ kind: 'operation_result', target: step.parent, fact: '图层滤镜列表已更新，可通过滤镜引用读回', capturedAt: new Date().toISOString() }] }
    })
  }
  async compensate(step: CollectionStep, result: ApplicationCompletedStepResult, context?: ApplicationExecutionContext) {
    if (!result.undoToken) return []
    const payload = collectionUndo(result.undoToken)
    return this.delegate(step.parent).compensate({ kind: 'mutation', target: step.parent, entityType: step.parent.kind, expectedRevisions: {}, mutations: [] }, { ...result, undoToken: payload.delegate }, context)
  }
  async undo(token: string, context?: ApplicationExecutionContext) {
    const payload = collectionUndo(token)
    const result = await new ImageEditV3LayerMutationExecutor().undo(payload.delegate, context)
    return { ...result, directRefs: payload.refs.map(ref => ({ kind: ref.kind, id: ref.id, revision: result.resultingRevisions.image_edit })) }
  }
}

export function imageEditLayerFilterRegistrationV3(): ApplicationEntityRegistration {
  return { entity: { id: ENTITY, domain: 'image_edit', version: 1, title: '图层滤镜', description: '内容图层上的有序、非破坏滤镜；开关、参数、强度、蒙版与顺序可独立修改。',
    refKind: ENTITY, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['image_edit.layer', 'image_edit.group'],
    revisionScopes: ['image_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: imageEditV3SchemaRef('entity', ENTITY),
    collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${ENTITY}.operation_type`, `${ENTITY}.effect_id`, `${ENTITY}.params`], maxItemsPerChange: 256 } },
    properties: fieldDescriptors(IMAGE_EDIT_V3_FILTER_FIELDS), provider: new FilterProvider(),
    schemaDocuments: [{ ref: imageEditV3SchemaRef('property', `${ENTITY}.mask.value`), value: z.toJSONSchema(imageEditLayerFilterSchemaV3.shape.mask, { io: 'input' }) as JsonValue }] }
}
