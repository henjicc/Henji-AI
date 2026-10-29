import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { ApplicationCollectionExecutor, ApplicationCompletedStepResult, ApplicationEntityRegistration, ApplicationPlannedStep, ApplicationRef, ApplicationSchemaRef, JsonValue } from '@/core/application-control'
import { unrestrictedCollectionAvailability } from '@/core/application-control'
import { listDeleted, restoreDeleted } from '@/services/recycle'
import type { RecycledItem } from '@/core/localRecords/recycle'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

/** 删除执行器只记回收身份，补偿与撤销统一交给回收服务。 */
export class RecyclableCollectionExecutor implements ApplicationCollectionExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  private readonly undoEntries = new Map<string, { pending: Array<{ ref: ApplicationRef; recycleId: string }>; refs: ApplicationRef[] }>()
  constructor(readonly entityType: string, private readonly dependencies: {
    read(ref: ApplicationRef): Promise<unknown>
    remove(ref: ApplicationRef): Promise<string>
    revisions(): Record<string, number> | Promise<Record<string, number>>
    changed?(): void | Promise<void>
  }) {}
  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.operation.kind !== 'remove') throw new Error('此集合只能删除已有内容；创建请使用对应的正式入口。')
    for (const ref of step.operation.targets) {
      if (ref.kind !== this.entityType) throw new Error('ENTITY_TYPE_MISMATCH')
      await this.dependencies.read(ref)
    }
    const removed: Array<{ ref: ApplicationRef; recycleId: string }> = []
    try {
      for (const ref of step.operation.targets) removed.push({ ref, recycleId: await this.dependencies.remove(ref) })
      await this.dependencies.changed?.()
      const undoToken = crypto.randomUUID()
      const result = await this.receipt(removed.map(item => item.ref), '内容已移到最近删除。', undoToken)
      this.undoEntries.set(undoToken, { pending: removed, refs: removed.map(item => item.ref) })
      return result
    } catch (error) {
      for (const item of removed.reverse()) await restoreDeleted(item.recycleId)
      throw error
    }
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const entry = this.undoEntries.get(token)
    if (!entry) throw new Error('UNDO_NOT_FOUND')
    const { pending: items, refs } = entry
    while (items.length) {
      await restoreDeleted(items[items.length - 1].recycleId)
      items.pop()
    }
    await this.dependencies.changed?.()
    const result = await this.receipt(refs, '内容已恢复。')
    this.undoEntries.delete(token)
    return result
  }
  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult) { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
  forget(token: string): void { this.undoEntries.delete(token) }
  private async receipt(refs: ApplicationRef[], fact: string, undoToken?: string): Promise<ApplicationCompletedStepResult> {
    return { status: 'completed', resultingRevisions: await this.dependencies.revisions(), directRefs: refs, undoToken,
      evidence: refs.map(target => ({ kind: 'operation_result', target, fact, capturedAt: new Date().toISOString() })) }
  }
}

/** 文件仓库也只返回同一回收身份，不维护各自的恢复副本。 */
export async function captureRecycledRemoval(remove: () => Promise<unknown>, matches: (item: RecycledItem) => boolean): Promise<string> {
  const before = new Set((await listDeleted()).map(item => item.id))
  await remove()
  const item = (await listDeleted()).find(item => !before.has(item.id) && matches(item))
  if (!item) throw new Error('删除已执行，但未找到恢复记录，请检查最近删除。')
  return item.id
}

export interface RecyclableRecord { id: string; name: string; content: JsonValue }
export interface RecyclableRecordSource {
  entityType: string
  domain: string
  title: string
  list(): Promise<RecyclableRecord[]>
  remove(id: string): Promise<string>
}

/** 尚未开放编辑的本地记录只公开真实内容与集合删除，不增加专用工具。 */
export function createRecyclableRecordSource(source: RecyclableRecordSource): { registration: ApplicationEntityRegistration; executor: ApplicationCollectionExecutor } {
  const scope = source.entityType
  let revision = 0, signature = ''
  const records = async (): Promise<RecyclableRecord[]> => {
    const values = await source.list(), next = JSON.stringify(values)
    if (signature !== next) { signature = next; revision++ }
    return values
  }
  const schemaRef = (kind: 'entity' | 'property', id: string): ApplicationSchemaRef => {
    const hash = [...id].reduce((value, character) => (value * 33 + character.charCodeAt(0)) >>> 0, 5381).toString(16)
    return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.padEnd(64, hash).slice(0, 64)}` }
  }
  const read = async (ref: ApplicationRef): Promise<RecyclableRecord> => {
    const record = (await records()).find(item => item.id === ref.id)
    if (!record || ref.kind !== source.entityType) throw new Error('NOT_FOUND')
    return record
  }
  const registration: ApplicationEntityRegistration = {
    entity: { id: source.entityType, domain: source.domain, version: 1, title: source.title, description: `${source.title}的本机记录；删除进入统一最近删除，可恢复。`, refKind: source.entityType,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['settings.registry'], revisionScopes: [scope], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', source.entityType),
      collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 64 } },
    properties: [
      { suffix: 'name', title: '名称', value: { kind: 'string' as const } },
    ].map(({ suffix, title, value }) => ({ id: `${source.entityType}.${suffix}`, entityType: source.entityType, version: 1, title, description: title, value, nullable: false,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: [], write: [] }, revisionScopes: [scope], schemaRef: schemaRef('property', `${source.entityType}.${suffix}`), readOnlyReason: '内容通过原列表的编辑入口维护；此实体支持通用集合删除及恢复。' })),
    provider: {
      entityType: source.entityType,
      async listEntities(request) {
        const values = await records(), offset = Number(request.cursor ?? 0), page = values.slice(offset, offset + request.limit)
        return { refs: page.map(item => ({ kind: source.entityType, id: item.id, label: item.name })), nextCursor: offset + page.length < values.length ? String(offset + page.length) : null, revisions: { [scope]: revision } }
      },
      async readEntity(ref, request) {
        const item = await read(ref), values = { [`${source.entityType}.name`]: item.name }
        return { ref, entityType: source.entityType, properties: Object.fromEntries(Object.entries(values).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), revisions: { [scope]: revision }, capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, ids) {
        await read(ref)
        return ids.map(propertyId => ({ propertyId, readable: true, writable: false, reasons: ['可通过集合删除并恢复。'], requiredPermissions: [], revisions: { [scope]: revision } }))
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(source.entityType, parent, { [scope]: revision }) },
    },
  }
  return { registration, executor: new RecyclableCollectionExecutor(source.entityType, { read, remove: ref => source.remove(ref.id), revisions: async () => { await records(); return { [scope]: revision } } }) }
}
