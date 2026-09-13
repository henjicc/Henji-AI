import { getPlatform } from '@/platform/runtime'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import type { SharedMemorySnapshot } from '@/core/assistant/memory'
import { type ApplicationFieldDefinition, type ApplicationEntityRegistration, type ApplicationMutationExecutor, type ApplicationPlannedStep,
  type ApplicationCompletedStepResult, fieldDescriptors, fieldReadValues, fieldWriterTable, writableProperties, propertyOperations,
  applyWriterTable, unrestrictedCollectionAvailability } from '@/core/application-control'

const entityType = 'assistant.shared_memory'
const ref = { kind: entityType, id: 'singleton' }
const schemaRef = (kind: 'entity' | 'property', id: string) => ({ catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${'8'.repeat(64)}` })
const fields: ApplicationFieldDefinition<SharedMemorySnapshot, { content?: string }>[] = [{
  propertyId: `${entityType}.content`,
  descriptor: { id: `${entityType}.content`, entityType, version: 1, title: '长期记忆摘要',
    description: '最多 800 字。只记录用户明确偏好、纠正和有用户反馈的模型经验；合并替换，不追加流水账。空字符串表示清空。当前指令与设置优先。',
    value: { kind: 'string', maxLength: 800 }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['settings:read'], write: ['settings:write'] }, revisionScopes: ['assistant_memory'], schemaRef: schemaRef('property', `${entityType}.content`) },
  read: source => source.content, writer: { write(draft, mutation) { if (typeof mutation.value !== 'string') throw new Error('INVALID_INPUT'); draft.content = mutation.value } }, storeActions: [],
}]
const writers = fieldWriterTable(fields)
const read = () => getPlatform().assistant.getSharedMemory()
const revisions = (state: SharedMemorySnapshot) => ({ assistant_memory: state.revision })
export function createSharedMemoryRegistration(): ApplicationEntityRegistration {
  return { entity: { id: entityType, domain: 'memory', version: 1, title: '共享长期记忆',
    description: '软件持久化的跨 Agent 用户偏好与使用经验。新任务读取，有明确新偏好时合并更新；不写密钥或未经用户评价的模型结论。',
    refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['assistant_memory'],
    queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType) },
    properties: fieldDescriptors(fields), provider: { entityType,
      async listEntities() { const state = await read(); return { refs: [ref], nextCursor: null, revisions: revisions(state) } },
      async readEntity(target, request) {
        if (target.kind !== entityType || target.id !== ref.id) throw new Error('NOT_FOUND')
        const state = await read()
        return { ref, entityType, revisions: revisions(state), properties: Object.fromEntries(Object.entries(fieldReadValues(fields, state)).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(_ref, propertyIds) { const state = await read(); return propertyIds.map(propertyId => ({ propertyId, readable: true, writable: state.enabled, reasons: state.enabled ? [] : ['用户已关闭长期记忆。'], requiredPermissions: ['settings:write'], revisions: revisions(state) })) },
      async getCollectionAvailability(request) { return unrestrictedCollectionAvailability(entityType, request, {}, ['settings:write']) },
    } }
}

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
export class SharedMemoryExecutor implements ApplicationMutationExecutor {
  readonly entityType = entityType
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(writers)
  readonly propertyOperations = propertyOperations(writers)
  async apply(step: Step): Promise<ApplicationCompletedStepResult> {
    if (step.target.kind !== entityType || step.target.id !== ref.id) throw new Error('NOT_FOUND')
    const before = await read()
    const draft: { content?: string } = {}
    await applyWriterTable(writers, draft, step.mutations)
    const after = await getPlatform().assistant.updateSharedMemory({ content: draft.content ?? before.content, expectedRevision: before.revision })
    return { status: 'completed', resultingRevisions: revisions(after), directRefs: [ref],
      evidence: [{ kind: 'entity_state', target: ref, fact: '共享记忆已保存。', capturedAt: new Date().toISOString() }],
      undoToken: JSON.stringify({ content: before.content, expectedRevision: after.revision }) }
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const after = await getPlatform().assistant.updateSharedMemory(JSON.parse(token))
    return { status: 'completed', resultingRevisions: revisions(after), directRefs: [ref], evidence: [{ kind: 'entity_state', target: ref, fact: '共享记忆已恢复。', capturedAt: new Date().toISOString() }] }
  }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
