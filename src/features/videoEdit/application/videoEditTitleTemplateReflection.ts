import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationCollectionExecutor, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationExecutionContext, type ApplicationEvidence, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { titleTemplateDefinitionSchema, titleTemplateSchema, type TitleTemplate } from '@/core/videoEdit/titleTemplates'
import { listTitleTemplates, requireTitleTemplate, useTitleTemplateLibrary } from './videoEditTitleTemplateLibrary'
import { requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'
import { videoEditSchemaRef } from './videoEditFields'

const type = 'video_edit.title_template'
const reason = '本机动态图形模板目录。内置项固定；通用集合创建/删除自定义模板，name/definition可通用修改，不进入剪辑撤销。definition 包含 kind 或 content（二选一）及 parameters，字段语义看 schema。content 是源画幅、fps 与文字/图形快照（start/track 相对组合起点），不携带媒体、代码或跟踪；图形动画使用源微秒，文字运动使用片段内帧。应用用 apply_video_edit_title_template 按画幅/时长换算，一步撤销；实例可用原图形/文字通用属性继续修改。'
const definitionSchema = titleTemplateDefinitionSchema
const fields: ApplicationFieldDefinition<TitleTemplate, TitleTemplate>[] = [
  { propertyId: `${type}.name`, storeActions: [], read: value => value.name, writer: { write: (draft, mutation) => { draft.name = titleTemplateSchema.shape.name.parse(mutation.value) } }, descriptor: { id: `${type}.name`, entityType: type, version: 1, title: '模板名称', description: '标题模板名称。', value: { kind: 'string', maxLength: 200 }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.name`) } },
  { propertyId: `${type}.definition`, storeActions: [], read: value => definitionSchema.parse({ ...(value.kind ? { kind: value.kind } : {}), ...(value.content ? { content: value.content } : {}), parameters: value.parameters }) as JsonValue, writer: { write: (draft, mutation) => { const definition = definitionSchema.parse(mutation.value); delete draft.kind; delete draft.content; Object.assign(draft, definition) } }, descriptor: { id: `${type}.definition`, entityType: type, version: 1, title: '模板内容与参数', description: reason, value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.definition.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.definition`) } },
]
const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
export function createTitleTemplateRegistration(): ApplicationEntityRegistration {
  return {
    entity: { id: type, domain: 'video_edit', version: 1, title: '动态图形标题模板', description: reason, refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), collectionWrite: { creatable: true, removable: true, requiredPropertyIds: fields.map(field => field.propertyId), maxItemsPerChange: 8 } },
    properties: fieldDescriptors(fields), schemaDocuments: [{ ref: videoEditSchemaRef('property', `${type}.definition.value`), value: z.toJSONSchema(definitionSchema) as JsonValue }],
    provider: {
      entityType: type,
      async listEntities(request) { const values = listTitleTemplates(); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: values.slice(offset, offset + request.limit).map(value => ({ kind: type, id: value.id, label: value.name })), nextCursor: offset + request.limit < values.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { if (ref.kind !== type) throw new Error('请使用 title_template 引用。'); const properties = fieldReadValues(fields, requireTitleTemplate(ref.id)); return { ref, entityType: type, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(properties).filter(([key]) => request.propertyIds!.includes(key))) : properties, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { const template = requireTitleTemplate(ref.id); const writable = !template.id.startsWith('title:'); return propertyIds.map(propertyId => { if (!fields.some(field => field.propertyId === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`); return { propertyId, readable: true, writable, reasons: writable ? [] : ['内置模板固定，请另存自定义模板。'], requiredPermissions: ['video_edit:read', ...(writable ? ['video_edit:write'] : [])], revisions: revisions() } }) },
      async getCollectionAvailability(parent) { const result = unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write']); if (parent.kind !== 'video_edit.document') throw new Error('本机标题模板需要已打开的剪辑 document 上下文。'); requireVideoEditInstance(parent.id); return result },
    },
  }
}
export class TitleTemplateCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  private undos = new Map<string, { before: TitleTemplate[]; after: TitleTemplate[]; refs: ApplicationRef[] }>()
  private result(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: revisions(), directRefs: refs, evidence: [{ kind: 'entity_state', fact: '已从正式本机标题模板库回读。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted(); if (step.parent.kind !== 'video_edit.document') throw new Error('请选择剪辑 document。'); requireVideoEditInstance(step.parent.id)
    const before = structuredClone(useTitleTemplateLibrary.getState().templates); let after = [...before]; const refs: ApplicationRef[] = []
    if (step.operation.kind === 'create') for (const item of step.operation.items) {
      if (Object.keys(item.properties).some(key => !fields.some(field => field.propertyId === key))) throw new Error('模板创建仅接受 name、definition。')
      const definition = definitionSchema.parse(item.properties[`${type}.definition`]); const value = titleTemplateSchema.parse({ ...definition, id: crypto.randomUUID(), name: item.properties[`${type}.name`] }); after.push(value); refs.push({ kind: type, id: value.id })
    } else { for (const ref of step.operation.targets) { if (ref.kind !== type || !before.some(value => value.id === ref.id)) throw new Error('只可删除本机自定义模板，内置模板固定。'); refs.push(ref) } after = after.filter(value => !refs.some(ref => ref.id === value.id)) }
    useTitleTemplateLibrary.getState().replace(after); const undoToken = crypto.randomUUID(); this.undos.set(undoToken, { before, after, refs }); if (this.undos.size > 64) this.undos.delete(this.undos.keys().next().value!)
    return this.result(refs, undoToken)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { const state = this.undos.get(token); if (!state || JSON.stringify(useTitleTemplateLibrary.getState().templates) !== JSON.stringify(state.after)) throw new Error('标题模板库已有后续修改，请重新读取。'); useTitleTemplateLibrary.getState().replace(state.before); this.undos.delete(token); return this.result(state.refs) }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}

/** Updating a local title definition uses the same schema/store as UI saves, with compensable transactions. */
export class TitleTemplateMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(fieldWriterTable(fields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fields))
  private undos = new Map<string, { before: TitleTemplate; after: TitleTemplate; ref: ApplicationRef }>()
  private result(ref: ApplicationRef, undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: revisions(), directRefs: [ref], evidence: [{ kind: 'entity_state', fact: '已从本机标题模板库回读。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const before = structuredClone(useTitleTemplateLibrary.getState().templates.find(value => value.id === step.target.id))
    if (step.target.kind !== type || !before) throw new Error('只可修改本机自定义模板，内置模板固定。')
    const draft = structuredClone(before); await applyWriterTable(fieldWriterTable(fields), draft, step.mutations); context.signal?.throwIfAborted()
    const library = useTitleTemplateLibrary.getState()
    if (JSON.stringify(library.templates.find(value => value.id === before.id)) !== JSON.stringify(before)) throw new Error('原模板已有后续修改，请重新读取。')
    const after = titleTemplateSchema.parse(draft); library.replace(library.templates.map(value => value.id === before.id ? after : value))
    const token = crypto.randomUUID(); this.undos.set(token, { before, after, ref: step.target }); return this.result(step.target, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const state = this.undos.get(token); const library = useTitleTemplateLibrary.getState()
    if (!state || JSON.stringify(library.templates.find(value => value.id === state.before.id)) !== JSON.stringify(state.after)) throw new Error('原模板已有后续修改，请重新读取。')
    library.replace(library.templates.map(value => value.id === state.before.id ? state.before : value)); this.undos.delete(token); return this.result(state.ref)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
