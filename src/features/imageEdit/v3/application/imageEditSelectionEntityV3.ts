import { z } from 'zod'
import { applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, propertyOperations, writableProperties, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationCompletedStepResult, type ApplicationPlannedStep, type JsonValue } from '@/core/application-control'
import { imageEditSelectionSessionSchemaV3, type ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session'
import { imageEditV3SchemaRef } from './imageEditV3Fields'
import { listImageEditDocumentInstancesV3, requireImageEditDocumentInstanceV3, getImageEditDocumentCatalogRevisionV3 } from './imageEditDocumentInstances'
import { imageEditV3DocumentRef, splitImageEditV3DocumentRef } from './imageEditDocumentRefs'
import { ensureImageEditRefInstanceV3 } from './imageEditDocumentLoading'

const entityType = 'image_edit.selection'
const schemaRef = imageEditV3SchemaRef('property', `${entityType}.region.value`)
type Draft = { value: ImageEditSelectionSessionV3 | null }
export const IMAGE_EDIT_SELECTION_FIELDS_V3: ApplicationFieldDefinition<Draft, Draft>[] = [{
  propertyId: `${entityType}.region`,
  descriptor: { id: `${entityType}.region`, entityType, version: 1, title: '选区形状与边缘',
    description: '独立于图层蒙版的当前选区。坐标为未裁剪画面比例，羽化为短边比例；形状按顺序组合。null 取消选区。应用到图层请使用 apply_image_edit_selection。',
    value: { kind: 'json', schemaRef }, nullable: true, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['image_edit:read'], write: ['image_edit:write'] }, revisionScopes: ['image_edit'], schemaRef: imageEditV3SchemaRef('property', `${entityType}.region`) },
  read: draft => draft.value as unknown as JsonValue,
  writer: { write(draft, mutation) { draft.value = mutation.value === null ? null : imageEditSelectionSessionSchemaV3.parse(mutation.value) } }, storeActions: [],
}]
const writers = fieldWriterTable(IMAGE_EDIT_SELECTION_FIELDS_V3)
const documentRef = (ref: { id: string }) => ({ kind: 'image_edit.document', id: ref.id })
const busFor = (ref: { id: string }) => requireImageEditDocumentInstanceV3(splitImageEditV3DocumentRef(documentRef(ref)).documentId).bus

export function imageEditSelectionRegistrationV3(): ApplicationEntityRegistration {
  return {
    entity: { id: entityType, domain: 'image_edit', version: 1, title: '当前图片选区', description: '每个打开图片文档的独立选区；修改可撤销，关闭会话后清理，应用蒙版才进入作品。', refKind: entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['image_edit.document'], revisionScopes: ['image_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: imageEditV3SchemaRef('entity', entityType) },
    properties: fieldDescriptors(IMAGE_EDIT_SELECTION_FIELDS_V3),
    schemaDocuments: [{ ref: schemaRef, value: z.toJSONSchema(imageEditSelectionSessionSchemaV3, { io: 'input' }) as JsonValue }],
    provider: {
      entityType,
      async listEntities(request) {
        const refs = listImageEditDocumentInstancesV3().map(instance => ({ ...imageEditV3DocumentRef(instance.documentId), kind: entityType }))
        const start = request.cursor ? Number(request.cursor) : 0
        return { refs: refs.slice(start, start + request.limit), nextCursor: start + request.limit < refs.length ? String(start + request.limit) : null, revisions: { image_edit: getImageEditDocumentCatalogRevisionV3() }, total: refs.length }
      },
      async readEntity(ref, request) {
        await ensureImageEditRefInstanceV3(documentRef(ref))
        const properties = fieldReadValues(IMAGE_EDIT_SELECTION_FIELDS_V3, { value: busFor(ref).getSnapshot().selection })
        return { ref, entityType, revisions: { image_edit: getImageEditDocumentCatalogRevisionV3() }, properties: Object.fromEntries(Object.entries(properties).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        await ensureImageEditRefInstanceV3(documentRef(ref))
        busFor(ref)
        return propertyIds.map(propertyId => ({ propertyId, readable: true, writable: true, reasons: [], requiredPermissions: ['image_edit:write'], revisions: { image_edit: getImageEditDocumentCatalogRevisionV3() } }))
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(entityType, parent, { image_edit: getImageEditDocumentCatalogRevisionV3() }, ['image_edit:write']) },
    },
  }
}

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
export class ImageEditSelectionMutationExecutorV3 implements ApplicationMutationExecutor {
  readonly entityType = entityType
  readonly writableProperties = writableProperties(writers)
  readonly propertyOperations = propertyOperations(writers)
  readonly effectContract = { direct: [], cascades: [] }
  async apply(step: Step, context: { signal?: AbortSignal }): Promise<ApplicationCompletedStepResult> {
    if (context.signal?.aborted) throw new Error('CANCELLED')
    const bus = busFor(step.target), draft = { value: bus.getSnapshot().selection }
    await applyWriterTable(writers, draft, step.mutations)
    const selectionCommandId = bus.setSelection(draft.value)
    return { status: 'completed', directRefs: [step.target], resultingRevisions: { image_edit: getImageEditDocumentCatalogRevisionV3() },
      evidence: [{ kind: 'entity_state', fact: '选区已写入当前文档会话，可通过 region 读回。', capturedAt: new Date().toISOString() }],
      ...(selectionCommandId !== null ? { undoToken: JSON.stringify({ ref: step.target, expected: draft.value, selectionCommandId }) } : {}) }
  }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) {
    if (result.undoToken) await this.restore(result.undoToken, true)
    return []
  }
  async undo(token: string) { return this.restore(token, false) }
  private async restore(token: string, rollback: boolean): Promise<ApplicationCompletedStepResult> {
    const parsed = z.object({ ref: z.object({ kind: z.literal(entityType), id: z.string() }).passthrough(), expected: imageEditSelectionSessionSchemaV3.nullable(), selectionCommandId: z.number().int().positive() }).strict().parse(JSON.parse(token))
    busFor(parsed.ref).restoreSelection(parsed.expected, parsed.selectionCommandId, rollback)
    return { status: 'completed', directRefs: [parsed.ref], resultingRevisions: { image_edit: getImageEditDocumentCatalogRevisionV3() }, evidence: [] }
  }
}
