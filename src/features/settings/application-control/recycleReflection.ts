import type { ApplicationCollectionExecutor, ApplicationEntityProvider, ApplicationEntityRegistration, ApplicationPlannedStep, ApplicationCompletedStepResult, ApplicationPropertyDescriptor, ApplicationRef } from '@/core/application-control'
import { unrestrictedCollectionAvailability } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { listDeleted, restoreDeleted } from '@/services/recycle'
import type { RecycledItem } from '@/core/localRecords/recycle'

const ENTITY = 'settings.deleted_item'
const scope = 'recycle'
let revision = 0
let signature = ''
async function items(): Promise<RecycledItem[]> {
  const values = await listDeleted()
  const next = JSON.stringify(values)
  if (next !== signature) { signature = next; revision++ }
  return values
}
const schemaRef = (kind: 'entity' | 'property', id: string): ApplicationPropertyDescriptor['schemaRef'] => ({
  catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1,
  digest: `sha256:${[...id].reduce((value, character) => (value * 33 + character.charCodeAt(0)) >>> 0, 5381).toString(16).padEnd(64, '0')}`,
})
const properties: ApplicationPropertyDescriptor[] = [
  { suffix: 'name', title: '名称', kind: 'string' as const },
  { suffix: 'category', title: '内容类型', kind: 'string' as const },
  { suffix: 'deleted_at', title: '删除时间', kind: 'number' as const },
].map(({ suffix, title, kind }) => ({
  id: `${ENTITY}.${suffix}`, entityType: ENTITY, version: 1, title, description: title,
  value: { kind }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
  requiredPermissions: { read: ['settings:read'], write: [] }, revisionScopes: [scope],
  schemaRef: schemaRef('property', `${ENTITY}.${suffix}`), readOnlyReason: '内容信息由回收区维护；从本集合移除条目会恢复原内容。',
}))

class RecycleProvider implements ApplicationEntityProvider {
  readonly entityType = ENTITY
  async listEntities(request: { cursor?: string; limit: number }) {
    const values = await items(), offset = Number(request.cursor ?? 0), page = values.slice(offset, offset + request.limit)
    return { refs: page.map(item => ({ kind: ENTITY, id: item.id, label: item.name })), nextCursor: offset + page.length < values.length ? String(offset + page.length) : null, revisions: { [scope]: revision } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const item = (await items()).find(item => item.id === ref.id)
    if (ref.kind !== ENTITY || !item) throw new Error('NOT_FOUND')
    const values = { [`${ENTITY}.name`]: item.name, [`${ENTITY}.category`]: item.category, [`${ENTITY}.deleted_at`]: item.deletedAt }
    return { ref, entityType: ENTITY, revisions: { [scope]: revision }, properties: Object.fromEntries(Object.entries(values).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, ids: string[]) {
    await this.readEntity(ref, {})
    return ids.map(propertyId => ({ propertyId, readable: true, writable: false, reasons: ['通过集合移除操作恢复内容。'], requiredPermissions: ['settings:read'], revisions: { [scope]: revision } }))
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(ENTITY, parent, { [scope]: revision }, ['settings:write'])
  }
}

export function createRecycleReflectionRegistration(): ApplicationEntityRegistration {
  return {
    entity: { id: ENTITY, domain: 'settings', version: 1, title: '最近删除', description: '统一回收区，保留 30 天。remove 操作将条目从最近删除移出，并把原内容恢复到原位置。', refKind: ENTITY,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['settings.registry'], revisionScopes: [scope], queryCapabilityIds: ['list_application_entities'], schemaRef: schemaRef('entity', ENTITY),
      collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 64 } },
    properties, provider: new RecycleProvider(),
  }
}

export class RecycleCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>): Promise<ApplicationCompletedStepResult> {
    if (step.operation.kind !== 'remove') throw new Error('最近删除只支持移出并恢复。')
    const values = await items()
    for (const target of step.operation.targets) {
      if (target.kind !== ENTITY || !values.some(item => item.id === target.id)) throw new Error('NOT_FOUND')
    }
    for (const target of step.operation.targets) await restoreDeleted(target.id)
    await items()
    return { status: 'completed', resultingRevisions: { [scope]: revision }, directRefs: step.operation.targets,
      evidence: [{ kind: 'operation_result', target: step.parent, fact: '内容已恢复到原位置。', data: { restored: step.operation.targets.length }, capturedAt: new Date().toISOString() }] }
  }
}
