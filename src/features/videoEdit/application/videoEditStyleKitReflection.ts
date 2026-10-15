import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationEntityRegistration, type ApplicationMutationExecutor, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationExecutionContext, type ApplicationEvidence, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { styleKitSchema, styleKitContentSchema, styleKitContent, STYLE_GUIDE_SECTIONS, type StyleKit } from '@/core/videoEdit/styleKit'
import { videoEditSchemaRef } from './videoEditFields'
import { listVideoEditInstances, requireVideoEditInstance, editVideoProject, restoreVideoEditSnapshot, videoEditDomainRevision } from './videoEditService'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { checkStyleKit, projectStyleKit } from './videoEditStyleKits'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'

export const STYLE_KIT_ENTITY = 'video_edit.style_kit'
export const STYLE_PRESET_ENTITY = 'video_edit.style_preset'
type StyleEntityType = typeof STYLE_KIT_ENTITY | typeof STYLE_PRESET_ENTITY
function split(ref: ApplicationRef): { projectId: string; id: string } { const colon = ref.id.indexOf(':'); if (colon < 0) throw new Error('请使用目录返回的完整工程风格包引用。'); return { projectId: ref.id.slice(0, colon), id: ref.id.slice(colon + 1) } }
function fieldsFor(type: StyleEntityType): ApplicationFieldDefinition<StyleKit, StyleKit>[] {
  const editable = (['name', 'content'] as const).map((key): ApplicationFieldDefinition<StyleKit, StyleKit> => ({ propertyId: `${type}.${key}`, storeActions: [], read: kit => (key === 'name' ? kit.name : styleKitContent(kit)) as JsonValue,
    writer: { write(draft, mutation) { if (key === 'name') draft.name = styleKitSchema.shape.name.parse(mutation.value); else Object.assign(draft, styleKitContentSchema.parse(mutation.value)) } },
    descriptor: { id: `${type}.${key}`, entityType: type, version: 2, title: key === 'name' ? '名称' : '风格内容', description: key === 'name' ? '风格名称；内置风格请复制。' : CONTENT_DESCRIPTION, value: key === 'name' ? { kind: 'string', maxLength: 200 } : { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.content.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', `${type}.${key}`) },
  }))
  return editable
}
const EDITABLE_KEYS = ['name', 'content']
const CONTENT_DESCRIPTION = `风格说明书：给 AI 的结构化提示词，不是参数或组件。{ guide, examples }：guide 为 Markdown，必须有二级标题 ${STYLE_GUIDE_SECTIONS.filter(spec => spec.required).map(spec => `“${spec.title}”`).join('、')}，可选“画面生成提示”（原地生成图片/视频时并入提示词），可追加自定义章节；强弱写在文字里（必须 / 尽量 / 可以），具体色值、字体、曲线直接写进文字。examples 为 0–6 段参考代码 { id, title, note（演示了哪几条规矩）, source }，只示意手法，不原样插入。修改时先读后整体写回。`
function list(type: StyleEntityType): Array<{ ref: ApplicationRef; kit: StyleKit }> {
  if (type === STYLE_PRESET_ENTITY) return videoEditStyleKitLibrary.list().map(kit => ({ ref: { kind: type, id: kit.id, label: kit.name }, kit }))
  return listVideoEditInstances().flatMap(owner => (owner.document.styleKits ?? []).map(kit => ({ ref: { kind: type, id: `${owner.document.id}:${kit.id}`, label: kit.name }, kit })))
}
function requireKit(type: StyleEntityType, ref: ApplicationRef): StyleKit { if (ref.kind !== type) throw new Error('风格实体类型无效，请使用目录返回的引用。'); const value = list(type).find(value => value.ref.id === ref.id); if (!value) throw new Error('NOT_FOUND：风格包已删除或所在工程未打开，请重新列出风格实体。'); return value.kit }
export function createStyleKitRegistration(type: StyleEntityType): ApplicationEntityRegistration {
  const fields = fieldsFor(type); const properties = fieldDescriptors(fields); const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  return { entity: { id: type, domain: 'video_edit', version: 1, title: type === STYLE_KIT_ENTITY ? '工程风格包' : '本机风格库', description: type === STYLE_KIT_ENTITY ? '工程内嵌的可移植风格快照。name/content 创建，再写 sequence.style_kit_id 的子标识绑定；修改内容进工程撤销栈。' : '应用共享的内置与个人风格库。读取 content 复制到工程 style_kit；保存工程内容可创建个人预设。改本机库不会暗改已有工程快照。', refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), collectionWrite: { creatable: true, removable: true, requiredPropertyIds: EDITABLE_KEYS.map(key => `${type}.${key}`), maxItemsPerChange: 32 } }, properties,
    schemaDocuments: [{ ref: videoEditSchemaRef('property', `${type}.content.value`), value: z.toJSONSchema(styleKitContentSchema, { io: 'input' }) as JsonValue }],
    provider: { entityType: type,
      async listEntities(request) { const all = list(type); const offset = Math.max(0, Number(request.cursor) || 0); return { refs: all.slice(offset, offset + request.limit).map(value => value.ref), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() } },
      async readEntity(ref, request) { const data = fieldReadValues(fields, requireKit(type, ref)); return { ref, entityType: type, properties: request.propertyIds?.length ? Object.fromEntries(Object.entries(data).filter(([key]) => request.propertyIds!.includes(key))) : data, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { const kit = requireKit(type, ref); const editable = type === STYLE_KIT_ENTITY || !kit.id.startsWith('builtin:'); return propertyIds.map(propertyId => { if (!properties.some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND：${propertyId}`); const writable = editable; return { propertyId, readable: true, writable, reasons: writable ? [] : ['内置风格固定，请复制到个人库或工程。'], requiredPermissions: ['video_edit:read', ...(writable ? ['video_edit:write'] : [])], revisions: revisions() } }) },
      async getCollectionAvailability(parent) { const result = unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write']); if (parent.kind !== 'video_edit.document') { result.create = { ...result.create, available: false, reasons: ['请使用已打开的剪辑文档引用。'] }; result.remove = { ...result.remove, available: false, reasons: ['请使用已打开的剪辑文档引用。'] } } else requireVideoEditInstance(parent.id); return result },
    },
  }
}
interface Undo { before: VideoEditDocument | StyleKit[]; after: VideoEditDocument | StyleKit[]; refs: ApplicationRef[]; projectId: string; owner?: object }
class StyleKitExecutorBase {
  readonly effectContract = { direct: [], cascades: [] }
  protected readonly undos = new Map<string, Undo>()
  constructor(readonly entityType: StyleEntityType) {}
  protected result(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', resultingRevisions: { video_edit: videoEditDomainRevision() }, directRefs: refs, evidence: [{ kind: 'entity_state', fact: '已从正式风格状态源回读。', capturedAt: new Date().toISOString() }], ...(undoToken ? { undoToken } : {}) } }
  protected snapshot(projectId: string): VideoEditDocument | StyleKit[] { return this.entityType === STYLE_KIT_ENTITY ? requireVideoEditInstance(projectId).document : videoEditStyleKitLibrary.custom() }
  protected remember(projectId: string, before: Undo['before'], refs: ApplicationRef[]): ApplicationCompletedStepResult { const token = crypto.randomUUID(); this.undos.set(token, { projectId, before, after: this.snapshot(projectId), refs, ...(this.entityType === STYLE_KIT_ENTITY ? { owner: requireVideoEditInstance(projectId) } : {}) }); return this.result(refs, token) }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { const state = this.undos.get(token); if (!state) throw new Error('原风格撤销记录不存在。'); if (Array.isArray(state.after)) { if (JSON.stringify(videoEditStyleKitLibrary.custom()) !== JSON.stringify(state.after)) throw new Error('本机风格库已有后续修改，请重新读取。'); videoEditStyleKitLibrary.replace(state.before as StyleKit[]) } else { if (requireVideoEditInstance(state.projectId) !== state.owner) throw new Error('原风格修改会话已关闭。'); restoreVideoEditSnapshot(state.projectId, state.after, state.before as VideoEditDocument) } this.undos.delete(token); return this.result(state.refs) }
}
export class VideoEditStyleKitCollectionExecutor extends StyleKitExecutorBase implements ApplicationCollectionExecutor {
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== 'video_edit.document') throw new Error('请使用剪辑文档作为风格库上下文。')
    const owner = requireVideoEditInstance(step.parent.id); const baseline = owner.document; const contentVersion = owner.contentVersion; const before = this.snapshot(step.parent.id); const refs: ApplicationRef[] = []; const values = Array.isArray(before) ? before : before.styleKits ?? []; let next = [...values]
    if (step.operation.kind === 'create') {
      for (const item of step.operation.items) {
        if (Object.keys(item.properties).some(key => !EDITABLE_KEYS.some(name => key === `${this.entityType}.${name}`))) throw new Error('风格创建仅接受 name/content。')
        const kit = await checkStyleKit(styleKitSchema.parse({ id: crypto.randomUUID(), name: item.properties[`${this.entityType}.name`], ...styleKitContentSchema.parse(item.properties[`${this.entityType}.content`]) }), context.signal)
        next.push(kit); refs.push({ kind: this.entityType, id: this.entityType === STYLE_KIT_ENTITY ? `${owner.document.id}:${kit.id}` : kit.id })
      }
    } else {
      for (const ref of step.operation.targets) { requireKit(this.entityType, ref); const id = this.entityType === STYLE_KIT_ENTITY ? split(ref).id : ref.id; if (this.entityType === STYLE_KIT_ENTITY && split(ref).projectId !== step.parent.id || !values.some(value => value.id === id)) throw new Error('只能删除此上下文中的自定义风格。'); if (this.entityType === STYLE_KIT_ENTITY && baseline.sequences.some(sequence => sequence.styleKitId === id)) throw new Error('风格仍被序列使用，请先清除序列绑定。'); next = next.filter(value => value.id !== id); refs.push(ref) }
    }
    context.signal?.throwIfAborted(); if (!isVideoEditContentCurrent(owner, contentVersion) || Array.isArray(before) && JSON.stringify(this.snapshot(step.parent.id)) !== JSON.stringify(before)) throw new Error('检查期间风格状态已修改，请重新读取。')
    if (this.entityType === STYLE_KIT_ENTITY) editVideoProject(step.parent.id, document => ({ ...document, styleKits: next })); else videoEditStyleKitLibrary.replace(next)
    return this.remember(step.parent.id, before, refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
export class VideoEditStyleKitMutationExecutor extends StyleKitExecutorBase implements ApplicationMutationExecutor {
  readonly writableProperties; readonly propertyOperations
  constructor(type: StyleEntityType) { super(type); const table = fieldWriterTable(fieldsFor(type)); this.writableProperties = writableProperties(table); this.propertyOperations = propertyOperations(table) }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const old = requireKit(this.entityType, step.target); if (old.id.startsWith('builtin:')) throw new Error('内置风格固定，请复制到个人库。')
    const projectId = this.entityType === STYLE_KIT_ENTITY ? split(step.target).projectId : ''
    const owner = this.entityType === STYLE_KIT_ENTITY ? requireVideoEditInstance(projectId) : undefined; const contentVersion = owner?.contentVersion; const before = this.snapshot(projectId); const draft = structuredClone(old)
    await applyWriterTable(fieldWriterTable(fieldsFor(this.entityType)), draft, step.mutations)
    const checked = await checkStyleKit(draft, context.signal); context.signal?.throwIfAborted()
    if (owner && !isVideoEditContentCurrent(owner, contentVersion!) || Array.isArray(before) && JSON.stringify(this.snapshot(projectId)) !== JSON.stringify(before)) throw new Error('检查期间风格状态已修改，请重新读取。')
    if (this.entityType === STYLE_KIT_ENTITY) editVideoProject(projectId, document => ({ ...document, styleKits: document.styleKits!.map(kit => kit.id === old.id ? { ...checked, revision: projectStyleKit(document, old.id).revision + 1 } : kit) })); else videoEditStyleKitLibrary.update(old.id, checked)
    return this.remember(projectId, before, [step.target])
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
