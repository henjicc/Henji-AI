import { z } from 'zod'
import { fieldDescriptors, fieldReadValues, unrestrictedCollectionAvailability, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationExecutionContext, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationRef, type JsonValue } from '@/core/application-control'
import type { CodeComponent } from '@/core/videoEdit/codeMaterial/components'
import { codeComponentNameSchema, componentSourceMetadata } from '@/core/videoEdit/codeMaterial/components'
import { codeSourceTextSchema, componentFileReferences } from '@/core/videoEdit/codeMaterial/sources'
import { videoEditSchemaRef } from './videoEditFields'
import { listVideoEditInstances, requireVideoEditInstance, videoEditDomainRevision } from './videoEditService'
import { projectCodeComponents, publishProjectCodeComponent, refuseCodeComponentRemoval, withdrawProjectCodeComponents, codeComponentReferences, type CodeComponentReference } from './videoEditCodeStorage'
import type { CodeComponentPin } from '@/core/videoEdit/codeMaterial/sources'

export const CODE_COMPONENT_ENTITY = 'video_edit.code_component'
const type = CODE_COMPONENT_ENTITY
const reason = '项目组件每次发布创建不可变版本，现有素材固定引用原版本。修改请以相同 name 和新 source 再创建；此集合不删除已发布文件，删除整个组件需要单独的破坏性授权。'
const creation = { name: codeComponentNameSchema, source: codeSourceTextSchema, description: z.string().max(10000).default('') }
interface ComponentReadData extends CodeComponent { references: CodeComponentReference[] }
const field = (key: string, title: string, value: ApplicationFieldDefinition<ComponentReadData, ComponentReadData>['descriptor']['value'], read: (component: ComponentReadData) => JsonValue): ApplicationFieldDefinition<ComponentReadData, ComponentReadData> => ({
  propertyId: `${type}.${key}`, storeActions: [], read,
  descriptor: { id: `${type}.${key}`, entityType: type, version: 1, title, description: key === 'source' ? '最新版本模块源码，仅允许 const、export const、纯箭头函数和静态声明；不允许 export default。使用 import { 名称 } from "@组件/组件名"，或 "@组件/组件名@2" 固定版本。发布时钉住依赖并拒绝循环。' : reason, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['video_edit:read'], write: [] }, revisionScopes: ['video_edit'], readOnlyReason: reason, schemaRef: videoEditSchemaRef('property', `${type}.${key}`) },
})
const latest = (component: CodeComponent) => component.versions.find(version => version.version === component.latestVersion)!
const fields = [
  field('name', '组件名称', { kind: 'string', maxLength: 200 }, component => component.name),
  field('source', '源码', { kind: 'string', maxLength: 65536 }, component => componentSourceMetadata(latest(component).source).source),
  field('description', '说明', { kind: 'string' }, component => latest(component).description),
  field('latest_version', '最新版本', { kind: 'number', hardRange: { min: 1, step: 1 } }, component => component.latestVersion),
  field('exports', '导出名称', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.exports.value`) }, component => latest(component).exports),
  field('versions', '各版本', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.versions.value`) }, component => JSON.parse(JSON.stringify(component.versions.map(version => ({ ...version, source: componentSourceMetadata(version.source).source, imports: componentFileReferences(version.imports).map(file => ({ name: file.path.slice('@组件/'.length, file.path.lastIndexOf('@')), version: Number(file.path.slice(file.path.lastIndexOf('@') + 1)), location: file.location, hash: file.hash })) })))) as JsonValue),
  field('references', '引用此组件的素材', { kind: 'json', schemaRef: videoEditSchemaRef('property', `${type}.references.value`) }, component => JSON.parse(JSON.stringify(component.references)) as JsonValue),
]
function split(ref: ApplicationRef): { projectId: string; name: string } {
  const index = ref.id.indexOf(':')
  if (ref.kind !== type || index < 0) throw new Error('请使用项目组件目录返回的完整引用。')
  return { projectId: ref.id.slice(0, index), name: ref.id.slice(index + 1) }
}
async function requireComponent(ref: ApplicationRef, includeReferences = false): Promise<ComponentReadData> {
  const { projectId, name } = split(ref); const component = (await projectCodeComponents(projectId)).find(component => component.name === name)
  if (!component) throw new Error(`项目组件 ${name} 不存在，请重新列出组件。`)
  return { ...component, references: includeReferences ? await codeComponentReferences(projectId, name) : [] }
}
export function createCodeComponentRegistration(): ApplicationEntityRegistration {
  const revisions = (): Record<string, number> => ({ video_edit: videoEditDomainRevision() })
  return { entity: { id: type, domain: 'video_edit', version: 1, title: '项目代码组件', description: '同一项目所有剪辑共享的模块库。在剪辑文档下以 name/source/description 创建：新名字发布组件，相同名字发布新版本。素材保存时将 @组件/名称 解析为最新版本并钉住，@组件/名称@2 指定版本。组件更新不影响已有素材。', refKind: type, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['video_edit.document'], revisionScopes: ['video_edit'], queryCapabilityIds: ['read_application_entity'], schemaRef: videoEditSchemaRef('entity', type), collectionWrite: { creatable: true, removable: false, requiredPropertyIds: [`${type}.name`, `${type}.source`], maxItemsPerChange: 64 } }, properties: fieldDescriptors(fields),
    schemaDocuments: [
      ...Object.entries(creation).map(([key, schema]) => ({ ref: videoEditSchemaRef('property', `${type}.${key}.value`), value: z.toJSONSchema(schema, { io: 'input' }) as JsonValue })),
      { ref: videoEditSchemaRef('property', `${type}.exports.value`), value: { type: 'array', items: { type: 'string' } } },
      { ref: videoEditSchemaRef('property', `${type}.versions.value`), value: { type: 'array', items: { type: 'object' } } },
      { ref: videoEditSchemaRef('property', `${type}.references.value`), value: { type: 'array', items: { type: 'object' } } },
    ],
    provider: { entityType: type,
      async listEntities(request) {
        const lists = await Promise.all(listVideoEditInstances().map(async owner => (await projectCodeComponents(owner.document.id)).map(component => ({ kind: type, id: `${owner.document.id}:${component.name}`, label: component.name }))))
        const all = lists.flat(); const offset = Math.max(0, Number(request.cursor) || 0)
        return { refs: all.slice(offset, offset + request.limit), nextCursor: offset + request.limit < all.length ? String(offset + request.limit) : null, revisions: revisions() }
      },
      async readEntity(ref, request) { const selected = request.propertyIds?.length ? fields.filter(field => request.propertyIds!.includes(field.propertyId)) : fields; const values = fieldReadValues(selected, await requireComponent(ref, !request.propertyIds?.length || request.propertyIds.includes(`${type}.references`))); return { ref, entityType: type, properties: values, revisions: revisions(), capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, propertyIds) { await requireComponent(ref); return propertyIds.map(propertyId => { if (!fields.some(field => field.propertyId === propertyId)) throw new Error(`组件属性 ${propertyId} 不存在。`); return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['video_edit:read'], revisions: revisions() } }) },
      async getCollectionAvailability(parent) {
        const result = unrestrictedCollectionAvailability(type, parent, revisions(), ['video_edit:write'])
        result.remove = { ...result.remove, available: false, reasons: [reason] }
        if (parent.kind !== 'video_edit.document') result.create = { ...result.create, available: false, reasons: ['请使用剪辑文档引用作为组件库上下文。'] }
        else {
          requireVideoEditInstance(parent.id)
          const references = await codeComponentReferences(parent.id)
          if (references.length) result.remove.reasons.push(`已被素材引用：${[...new Set(references.map(reference => `${reference.documentName} / ${reference.materialRef.label}`))].join('、')}。可读取组件的 references 属性获得完整素材引用。`)
        }
        return result
      },
    },
  }
}
export class CodeComponentCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = type
  readonly effectContract = { direct: [], cascades: [] }
  private readonly receipts = new Map<string, { projectId: string; versions: CodeComponentPin[] }>()
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== 'video_edit.document') throw new Error('请在剪辑文档下发布项目组件。')
    if (step.operation.kind !== 'create') { const target = step.operation.targets[0]; return refuseCodeComponentRemoval(target ? split(target).name : '') }
    const refs: ApplicationRef[] = []
    const versions: CodeComponentPin[] = []
    try {
    for (const item of step.operation.items) {
      const data = Object.fromEntries(Object.entries(item.properties).map(([key, value]) => [key.startsWith(`${type}.`) ? key.slice(type.length + 1) : key, value]))
      const input = z.object(creation).strict().parse(data)
      const version = await publishProjectCodeComponent(step.parent.id, input, context.signal)
      versions.push(version)
      refs.push({ kind: type, id: `${step.parent.id}:${version.name}`, label: version.name })
    }
    } catch (error) { await withdrawProjectCodeComponents(step.parent.id, versions); throw error }
    const undoToken = crypto.randomUUID(); this.receipts.set(undoToken, { projectId: step.parent.id, versions })
    return { status: 'completed', directRefs: refs, undoToken, resultingRevisions: { video_edit: videoEditDomainRevision() }, evidence: [{ kind: 'entity_state', fact: '项目组件已写入不可变源码文件，可经同一组件实体读回。', capturedAt: new Date().toISOString() }] }
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (result.undoToken) await this.undo(result.undoToken)
    return [{ kind: 'entity_state', fact: '此事务的组件发布已撤回；源码文件和固定引用保留。', capturedAt: new Date().toISOString() }]
  }
  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const receipt = this.receipts.get(undoToken)
    if (!receipt) throw new Error('此组件发布已撤回或撤销凭据已失效。')
    await withdrawProjectCodeComponents(receipt.projectId, receipt.versions); this.receipts.delete(undoToken)
    return { status: 'completed', directRefs: [], resultingRevisions: { video_edit: videoEditDomainRevision() }, evidence: [{ kind: 'entity_state', fact: '组件发布已撤回，保留用户可见源码文件。', capturedAt: new Date().toISOString() }] }
  }
}
