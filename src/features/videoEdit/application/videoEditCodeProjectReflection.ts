import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, unrestrictedCollectionAvailability, type ApplicationFieldDefinition, type ApplicationEntityRegistration, type ApplicationMutationExecutor, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationExecutionContext, type ApplicationEvidence, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { codeProjectPathSchema, type CodeProjectFile } from '@/core/videoEdit/codeMaterial/projectContract'
import { codeSourceTextSchema } from '@/core/videoEdit/codeMaterial/sources'
import { getPlatform } from '@/platform/runtime'
import { videoEditDocumentSchema } from '@/core/videoEdit/document'
import { videoEditSchemaRef } from './videoEditFields'
import { listVideoEditInstances, requireVideoEditInstance, openVideoEditDocument, videoEditDomainRevision } from './videoEditService'
import { readVideoCodeProject, makeCodeProjectFile, replaceVideoCodeProjectFiles } from './videoEditCodeProject'

export const CODE_PROJECT_FILE = 'video_edit.code_project_file'
export const CODE_PROJECT = 'video_edit.code_project'
const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
const refOf = (id: string, path: string): ApplicationRef => ({ kind: CODE_PROJECT_FILE, id: `${id}:${path}`, label: path })
const renamedPaths = new Map<string, string>()
function split(ref: ApplicationRef): { id: string; path: string } {
  const index = ref.id.indexOf(':')
  return { id: index < 0 ? ref.id : ref.id.slice(0, index), path: renamedPaths.get(ref.id) ?? (index < 0 ? '' : ref.id.slice(index + 1)) }
}
type Data = Record<string, JsonValue>
function field(type: string, key: string, title: string, schema: z.ZodType, writable = false): ApplicationFieldDefinition<Data, Data> {
  const propertyId = `${type}.${key}`
  return { propertyId, storeActions: [], read: data => data[key] ?? null,
    ...(writable ? { writer: { write(data: Data, mutation: { value?: JsonValue }) { data[key] = schema.parse(mutation.value) as JsonValue } } } : {}),
    descriptor: { id: propertyId, entityType: type, version: 1, title, description: title, value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${propertyId}.value`) }, nullable: key === 'head', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: writable ? ['video_edit:write'] : [] }, revisionScopes: ['video_edit'], schemaRef: videoEditSchemaRef('property', propertyId), ...(!writable ? { readOnlyReason: '由工程工作区和不可变提交派生；文件经通用实体修改，外部修改用 commit_video_edit_code_project 提交。' } : {}) } }
}
const schemas = {
  path: codeProjectPathSchema, source: codeSourceTextSchema, hash: z.string(), bytes: z.number().int().nonnegative(), used_by: z.array(z.object({ kind: z.literal('video_edit.code_material'), id: z.string(), label: z.string() })),
}
const titles = { path: '工程相对路径；修改即改名或移动（不会自动改写 import）', source: 'UTF-8 文件内容', hash: '当前文件 SHA-256', bytes: 'UTF-8 字节数', used_by: '同项目各剪辑的默认版本依赖闭包引用' }
const fileFields = Object.entries(schemas).map(([key, schema]) => field(CODE_PROJECT_FILE, key, titles[key as keyof typeof titles], schema, key === 'path' || key === 'source'))
const projectSchemas = { head: z.string().nullable(), log: z.array(z.object({ oid: z.string(), message: z.string(), time: z.string(), paths: z.array(z.string()) })), tree: z.array(z.object({ path: z.string(), bytes: z.number() })), changes: z.array(z.object({ path: z.string(), kind: z.enum(['added', 'modified', 'deleted']) })) }
const projectFields = Object.entries(projectSchemas).map(([key, schema]) => field(CODE_PROJECT, key, ({ head: '当前提交', log: '最近20次提交及改动路径', tree: '当前工作区文件路径和字节数', changes: '工作区相对 HEAD 的未提交修改；读取不提交' })[key as keyof typeof projectSchemas], schema))
async function usedBy(id: string, path: string): Promise<ApplicationRef[]> {
  const container = requireVideoEditInstance(id).session.documentMeta.container
  const open = listVideoEditInstances().filter(owner => JSON.stringify(owner.session.documentMeta.container) === JSON.stringify(container))
  const documents = new Map(open.map(owner => [owner.document.id, owner.document]))
  for (const item of await getPlatform().documents.listDocuments({ container, kind: 'video_edit', includeMissing: false })) if (!documents.has(item.id)) documents.set(item.id, videoEditDocumentSchema.parse((await getPlatform().documents.readDocument({ id: item.id, path: item.path })).content))
  return [...documents.values()].flatMap(document => (document.codeMaterials ?? []).filter(material => material.versions.find(version => version.id === material.defaultVersionId)?.files.some(file => file.path === path)).map(material => ({ kind: 'video_edit.code_material', id: `${document.id}:${material.id}`, label: material.name })))
}
async function dataOf(ref: ApplicationRef, references = false): Promise<Data> {
  const { id, path } = split(ref); await openVideoEditDocument({ id }, { focus: false })
  const state = await readVideoCodeProject(id)
  if (ref.kind === CODE_PROJECT) return { head: state.head, log: state.log, tree: state.tree, changes: state.changes }
  const file = state.files.find(file => file.path === path)
  if (!file) throw new Error(`NOT_FOUND：工程文件 ${path} 不存在，请重新列出 ${CODE_PROJECT_FILE}。`)
  return { ...file, used_by: references ? await usedBy(id, path) : [] }
}
export function createCodeProjectRegistrations(): ApplicationEntityRegistration[] {
  return [CODE_PROJECT_FILE, CODE_PROJECT].map(type => {
    const fields = type === CODE_PROJECT_FILE ? fileFields : projectFields
    const values = type === CODE_PROJECT_FILE ? schemas : projectSchemas
    return { entity: { id: type, domain: 'video_edit', version: 1, title: type === CODE_PROJECT ? '片子代码工程' : '工程文件', description: '同项目文件夹内所有剪辑共用一个源码工程，文件挂在剪辑文档下。一次通用事务提交一次，撤销追加恢复提交。', refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), ...(type === CODE_PROJECT_FILE ? { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${type}.path`, `${type}.source`], maxItemsPerChange: 256 } } : { writeExclusion: { reason: '只读工程状态，由文件事务与 commit_video_edit_code_project 维护。' } }) },
      properties: fieldDescriptors(fields), schemaDocuments: Object.entries(values).map(([key, schema]) => ({ ref: videoEditSchemaRef('property', `${type}.${key}.value`), value: z.toJSONSchema(schema, { io: 'input' }) as JsonValue, validator: schema })),
      provider: { entityType: type,
        async listEntities(request) {
          const all = (await Promise.all(listVideoEditInstances().map(async owner => type === CODE_PROJECT ? [{ kind: type, id: owner.document.id, label: owner.document.name }] : (await readVideoCodeProject(owner.document.id)).files.map(file => refOf(owner.document.id, file.path))))).flat()
          const offset = Number(request.cursor) || 0
          return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() }
        },
        async readEntity(ref, request) { const selected = request.propertyIds?.length ? fields.filter(field => request.propertyIds!.includes(field.propertyId)) : fields; return { ref, entityType: type, properties: fieldReadValues(selected, await dataOf(ref, selected.some(field => field.propertyId.endsWith('.used_by')))), revisions: revisions(), capturedAt: new Date().toISOString() } },
        async getPropertyAvailability(ref, propertyIds) {
          await dataOf(ref)
          return propertyIds.map(propertyId => { const field = fields.find(field => field.propertyId === propertyId); if (!field) throw new Error(`属性 ${propertyId} 不存在；可用：${fields.map(field => field.propertyId).join('、')}`); return { propertyId, readable: true, writable: !!field.writer, reasons: field.writer ? [] : [field.descriptor.readOnlyReason!], requiredPermissions: ['video_edit:read'], revisions: revisions() } })
        },
        async getCollectionAvailability(parent) { if (parent.kind !== 'video_edit.document') throw new Error('请使用 video_edit.document 作为工程父对象。'); await openVideoEditDocument({ id: parent.id }, { focus: false }); return unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write']) },
      },
    }
  })
}
type FileStep = Extract<ApplicationPlannedStep, { kind: 'mutation' | 'collection' }>
const undo = new Map<string, { id: string; before: CodeProjectFile[]; after: CodeProjectFile[]; refs: ApplicationRef[]; renames: Map<string, string> }>()
const result = (refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult => ({ status: 'completed', directRefs: refs, resultingRevisions: revisions(), undoToken, evidence: [{ kind: 'entity_state', fact: '工程文件已在事务中更新，可读回；批次结束提交一次。', capturedAt: new Date().toISOString() }] })
async function apply(step: FileStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
  const id = split(step.kind === 'mutation' ? step.target : step.parent).id
  const before = structuredClone((await readVideoCodeProject(id)).files); let after = structuredClone(before); const refs: ApplicationRef[] = []; const renames = new Map(renamedPaths)
  if (step.kind === 'mutation') {
    const original = after.find(file => file.path === split(step.target).path)
    if (!original) throw new Error(`工程文件 ${split(step.target).path} 不存在。`)
    const draft: Data = { ...original }; await applyWriterTable(fieldWriterTable(fileFields), draft, step.mutations)
    const file = await makeCodeProjectFile(String(draft.path), String(draft.source))
    if (file.path !== original.path && after.some(other => other.path.toLowerCase() === file.path.toLowerCase())) throw new Error(`工程文件 ${file.path} 已存在，不能覆盖。`)
    after = after.map(other => other === original ? file : other); refs.push(step.target); if (file.path !== original.path) renamedPaths.set(step.target.id, file.path)
  } else if (step.operation.kind === 'create') {
    for (const item of step.operation.items) {
      const raw = Object.fromEntries(Object.entries(item.properties).map(([key, value]) => [key.replace(`${CODE_PROJECT_FILE}.`, ''), value]))
      const parsed = z.object({ path: schemas.path, source: schemas.source }).strict().parse(raw)
      if (after.some(file => file.path.toLowerCase() === parsed.path.toLowerCase())) throw new Error(`工程文件 ${parsed.path} 已存在，不能覆盖。`)
      after.push(await makeCodeProjectFile(parsed.path, parsed.source)); refs.push(refOf(id, parsed.path))
    }
  } else for (const ref of step.operation.targets) {
    const parsed = split(ref)
    if (parsed.id !== id || ref.kind !== CODE_PROJECT_FILE || !after.some(file => file.path === parsed.path)) throw new Error(`工程文件 ${parsed.path} 不属于当前工程或不存在。`)
    after = after.filter(file => file.path !== parsed.path); refs.push(ref)
  }
  context.signal?.throwIfAborted()
  await replaceVideoCodeProjectFiles(id, after, context.transactionSummary ?? '修改代码工程')
  const token = crypto.randomUUID(); undo.set(token, { id, before, after, refs, renames }); return result(refs, token)
}
async function restore(token: string): Promise<ApplicationCompletedStepResult> {
  const record = undo.get(token); if (!record) throw new Error('工程文件撤销记录已失效。')
  const signature = (files: CodeProjectFile[]) => JSON.stringify(files.map(file => [file.path, file.hash]).sort(([a], [b]) => a.localeCompare(b)))
  if (signature((await readVideoCodeProject(record.id)).files) !== signature(record.after)) throw new Error('工程文件已有后续或外部修改，请先读取 changes 并处理后再撤销。')
  await replaceVideoCodeProjectFiles(record.id, record.before, '撤销代码工程修改'); renamedPaths.clear(); for (const [key, value] of record.renames) renamedPaths.set(key, value); return result(record.refs)
}
export class CodeProjectFileMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = CODE_PROJECT_FILE
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(fieldWriterTable(fileFields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(fileFields))
  apply = apply
  undo = restore
  async compensate(_step: FileStep, receipt: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return receipt.undoToken ? (await restore(receipt.undoToken)).evidence : [] }
  forget(token: string): void { undo.delete(token) }
}
export class CodeProjectFileCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CODE_PROJECT_FILE
  readonly effectContract = { direct: [], cascades: [] }
  apply = apply
  undo = restore
  async compensate(_step: FileStep, receipt: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return receipt.undoToken ? (await restore(receipt.undoToken)).evidence : [] }
  forget(token: string): void { undo.delete(token) }
}
