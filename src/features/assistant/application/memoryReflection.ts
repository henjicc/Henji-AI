import { z } from 'zod'
import { getPlatform } from '@/platform/runtime'
import { sha256HexString } from '@/utils/save/hash'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { fieldDescriptors, fieldReadValues, fieldWriterTable, writableProperties, propertyOperations, applyWriterTable, unrestrictedCollectionAvailability,
  type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationCollectionExecutor,
  type ApplicationPlannedStep, type ApplicationCompletedStepResult, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { memoryHistoryEntrySchema, memoryEntryInputSchema, type MemoryEntry, type MemoryEntryInput, type MemoryTarget, type MemoryLayer, type MemorySnapshot } from '@/core/assistant/memoryEntries'
import { readMemory, writeMemory, refreshMemory, revertMemory } from '../memory/memoryService'
import { videoEditStyleLibrary } from '@/features/videoEdit/application/videoEditStyleLibrary'

import { MEMORY_RULES } from '@/core/assistant/memoryEntries'
const types = { global: 'assistant.memory', project: 'document.project_memory', style: 'video_edit.style_preference' } as const
const parents = { global: 'assistant.memory_settings', project: 'documents.project', style: 'video_edit.style' } as const
const schemaRef = (kind: 'entity' | 'property', id: string) => ({ catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${'9'.repeat(64)}` })
const rootRef = { kind: 'assistant.memory_settings', id: 'singleton' }
type Draft = { entry: MemoryEntryInput }
const scope = async (ref: ApplicationRef): Promise<string> => `memory.${await sha256HexString(`${ref.kind}:${ref.id}`)}`
function targetOf(layer: MemoryLayer, ref: ApplicationRef): { target: MemoryTarget; id: string } {
  if (layer === 'global') return { target: { layer }, id: ref.id }
  const index = ref.id.indexOf(':')
  if (index < 1) throw new Error('INVALID_REF：请使用列出记忆返回的完整引用。')
  return { target: { layer, ownerId: ref.id.slice(0, index) }, id: ref.id.slice(index + 1) }
}
function refOf(target: MemoryTarget, id: string): ApplicationRef { return { kind: types[target.layer], id: target.layer === 'global' ? id : `${target.ownerId}:${id}` } }
async function entryState(layer: MemoryLayer, ref: ApplicationRef): Promise<{ entry: MemoryEntry; target: MemoryTarget; revisions: Record<string, number> }> {
  const { target, id } = targetOf(layer, ref)
  const entry = (await readMemory(target)).find(value => value.id === id)
  if (!entry) throw new Error('NOT_FOUND：记忆不存在，请重新列出。')
  return { entry, target, revisions: { assistant_memory: 0, [await scope(ref)]: entry.revision } }
}
function fields(layer: MemoryLayer): ApplicationFieldDefinition<Draft, Draft>[] {
  const entityType = types[layer]
  const id = `${entityType}.entry`
  return [{ propertyId: id, storeActions: [], descriptor: { id, entityType, version: 1, title: '记忆内容',
    description: `逐条修改，先读后带 baselineIds 保存；CONFLICT 重读合并。${MEMORY_RULES} 内容一句话最多200字，全局分区 about/creative/habits。助手调用写入 source 必须为 assistant（user 仅由用户手动编辑写入）；precedence 仅全局creative可设 style/preference。value 支持 font.zh/font.latin/font.numeric 的 fonts 优先链、style 的 id、voice 的 providerId/voiceId、aspect 的 width/height。`,
    value: { kind: 'json', schemaRef: schemaRef('property', `${id}.value`) }, nullable: false, requiresReadBaseline: true,
    dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: ['settings:write'] }, revisionScopes: ['assistant_memory'], schemaRef: schemaRef('property', id) },
    read: draft => draft.entry as JsonValue, writer: { write: (draft, mutation) => { draft.entry = memoryEntryInputSchema.parse(mutation.value) } } }]
}
export function createMemoryRegistrations(): ApplicationEntityRegistration[] {
  return [createMemorySettingsRegistration(), ...(Object.keys(types) as MemoryLayer[]).map((layer): ApplicationEntityRegistration => {
    const entityType = types[layer], definitions = fields(layer)
    return { entity: { id: entityType, domain: 'memory', version: 1, title: { global: '全局记忆', project: '项目记忆', style: '风格使用者偏好' }[layer], description: MEMORY_RULES,
      refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [parents[layer]], revisionScopes: ['assistant_memory'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType),
      collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${entityType}.entry`], maxItemsPerChange: 10 } },
    properties: fieldDescriptors(definitions), schemaDocuments: [{ ref: schemaRef('property', `${entityType}.entry.value`), value: z.toJSONSchema(memoryEntryInputSchema) as JsonValue, validator: memoryEntryInputSchema }],
    provider: { entityType,
      async listEntities(request) {
        if (!(await refreshMemory()).settings.enabled) return { refs: [], nextCursor: null, revisions: { assistant_memory: 1 } }
        const targets: MemoryTarget[] = layer === 'global' ? [{ layer }] : layer === 'project'
          ? (await getPlatform().documents.listProjects()).map(value => ({ layer, ownerId: value.id }))
          : (await videoEditStyleLibrary.ready(), videoEditStyleLibrary.listStyles().map(value => ({ layer, ownerId: value.style.id })))
        const refs: ApplicationRef[] = []
        for (const target of targets) for (const entry of await readMemory(target)) refs.push({ ...refOf(target, entry.id), label: entry.content })
        const start = Number(request.cursor ?? 0), end = start + request.limit
        return { refs: refs.slice(start, end), nextCursor: end < refs.length ? String(end) : null, revisions: { assistant_memory: 0 } }
      },
      async readEntity(ref) {
        const state = await entryState(layer, ref)
        return { ref, entityType, revisions: state.revisions, properties: fieldReadValues(definitions, { entry: memoryEntryInputSchema.strip().parse(state.entry) }), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        const enabled = (await refreshMemory()).settings.enabled
        const state = enabled ? await entryState(layer, ref) : undefined
        return propertyIds.map(propertyId => ({ propertyId, readable: enabled, writable: enabled, reasons: enabled ? [] : ['记忆已关闭。'], requiredPermissions: ['settings:write'], revisions: state?.revisions ?? { assistant_memory: 1 } }))
      },
      async getCollectionAvailability(parent) {
        const enabled = (await refreshMemory()).settings.enabled
        const result = unrestrictedCollectionAvailability(entityType, parent, { assistant_memory: enabled ? 0 : 1 }, ['settings:write'])
        if (!enabled) for (const operation of [result.create, result.remove]) { operation.available = false; operation.reasons = ['记忆已关闭。'] }
        return result
      },
    } }
  })]
}

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' | 'collection' }>
export class MemoryExecutor implements ApplicationMutationExecutor, ApplicationCollectionExecutor {
  readonly entityType: string
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties
  readonly propertyOperations
  private readonly table
  constructor(private readonly layer: MemoryLayer) { this.entityType = types[layer]; this.table = fieldWriterTable(fields(layer)); this.writableProperties = writableProperties(this.table); this.propertyOperations = propertyOperations(this.table) }
  async apply(step: Step): Promise<ApplicationCompletedStepResult> {
    const changes: string[] = [], refs: ApplicationRef[] = []
    const resultingRevisions: Record<string, number> = { assistant_memory: 0 }
    const write = async (ref: ApplicationRef, target: MemoryTarget, id: string, expectedRevision: number, entry: MemoryEntryInput | null): Promise<void> => {
      const change = await writeMemory({ target, id, expectedRevision, entry: entry ? { ...entry, source: 'assistant' } : null, actor: 'assistant', reason: entry?.reason ?? '根据用户明确表达的偏好更新记忆。' })
      if (change) changes.push(change.id)
      refs.push(ref); resultingRevisions[await scope(ref)] = change ? change.after?.revision ?? 0 : expectedRevision
    }
    try {
      if (step.kind === 'mutation') {
        const current = await entryState(this.layer, step.target)
        const expected = step.expectedRevisions[await scope(step.target)]
        if (expected === undefined) throw new Error('BASELINE_REQUIRED：先读取这一条记忆，再携带 baselineIds 修改。')
        const draft = { entry: memoryEntryInputSchema.strip().parse(current.entry) }
        await applyWriterTable(this.table, draft, step.mutations)
        await write(step.target, current.target, current.entry.id, expected, draft.entry)
      } else if (step.operation.kind === 'create') {
        if (step.parent.kind !== parents[this.layer]) throw new Error(`INVALID_PARENT：请在 ${parents[this.layer]} 下新增。`)
        const target: MemoryTarget = this.layer === 'global' ? { layer: 'global' } : { layer: this.layer, ownerId: step.parent.id }
        for (const item of step.operation.items) { const id = crypto.randomUUID(); await write(refOf(target, id), target, id, 0, memoryEntryInputSchema.parse(item.properties[`${this.entityType}.entry`])) }
      } else for (const ref of step.operation.targets) {
        const current = await entryState(this.layer, ref)
        const expected = step.expectedRevisions[await scope(ref)]
        if (expected === undefined) throw new Error('BASELINE_REQUIRED：删除前先读取该条记忆。')
        await write(ref, current.target, current.entry.id, expected, null)
      }
    } catch (error) { for (const id of changes.reverse()) await revertMemory(id, 'assistant'); throw error }
    return { status: 'completed', resultingRevisions, directRefs: refs, evidence: refs.map(target => ({ kind: 'entity_state', target, fact: '记忆已保存。', capturedAt: new Date().toISOString() })), undoToken: JSON.stringify(changes) }
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { const ids = z.array(z.string()).parse(JSON.parse(token)); for (const id of ids.reverse()) await revertMemory(id, 'assistant'); return { status: 'completed', resultingRevisions: { assistant_memory: 0 }, directRefs: [], evidence: [] } }
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}

export { rootRef as MEMORY_ROOT_REF }

const rootFields: ApplicationFieldDefinition<MemorySnapshot, MemorySnapshot>[] = (['enabled', 'autoOrganize', 'history'] as const).map(key => {
  const writable = key !== 'history', id = `${rootRef.kind}.${key === 'autoOrganize' ? 'auto_organize' : key}`
  return { propertyId: id, storeActions: [], descriptor: { id, entityType: rootRef.kind, version: 1, title: { enabled: '使用与更新记忆', autoOrganize: '自动整理', history: '修改历史' }[key],
    description: key === 'history' ? '最近100次修改，含谁、哪层、改前改后与原因。使用 revert_assistant_memory 撤回某次修改。' : key === 'enabled' ? '关闭后所有层记忆不读不写，包括自动整理与软件默认值。' : '任务结束后累计10次修改或达到容量时整理，每天最多一次。',
    value: writable ? { kind: 'boolean' } : { kind: 'json', schemaRef: schemaRef('property', `${id}.value`) }, nullable: false,
    dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: writable ? ['settings:write'] : [] }, revisionScopes: ['memory_settings'], schemaRef: schemaRef('property', id),
    ...(!writable ? { readOnlyReason: '修改历史由记忆写入与撤回操作维护。' } : {}) },
    read: state => key === 'history' ? state.history as unknown as JsonValue : state.settings[key],
    ...(key !== 'history' ? { writer: { write: (draft: MemorySnapshot, mutation: { value?: JsonValue }) => { draft.settings[key] = z.boolean().parse(mutation.value) } } } : {}),
  }
})
function createMemorySettingsRegistration(): ApplicationEntityRegistration {
  const entityType = rootRef.kind
  return { entity: { id: entityType, domain: 'memory', version: 1, title: '助手记忆设置与历史', description: '全局记忆集合的父实体，读取与设置记忆开关，查看修改历史。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['memory_settings'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType) },
    properties: fieldDescriptors(rootFields), schemaDocuments: [{ ref: schemaRef('property', `${entityType}.history.value`), value: z.toJSONSchema(z.array(memoryHistoryEntrySchema)) as JsonValue, validator: z.array(memoryHistoryEntrySchema) }], provider: { entityType,
      async listEntities() { return { refs: [rootRef], nextCursor: null, revisions: { memory_settings: (await refreshMemory()).revision } } },
      async readEntity(ref) { if (ref.id !== 'singleton') throw new Error('NOT_FOUND'); const state = await refreshMemory(); return { ref, entityType, properties: fieldReadValues(rootFields, state), revisions: { memory_settings: state.revision }, capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(_ref, propertyIds) { const state = await refreshMemory(); return propertyIds.map(propertyId => ({ propertyId, readable: true, writable: !propertyId.endsWith('.history'), reasons: propertyId.endsWith('.history') ? ['历史由记忆写入与撤回操作维护。'] : [], requiredPermissions: ['settings:write'], revisions: { memory_settings: state.revision } })) },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(entityType, parent, { memory_settings: (await refreshMemory()).revision }, ['settings:write']) },
    } }
}
export class MemorySettingsExecutor implements ApplicationMutationExecutor {
  readonly entityType = rootRef.kind
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(fieldWriterTable(rootFields))
  readonly propertyOperations = propertyOperations(fieldWriterTable(rootFields))
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>): Promise<ApplicationCompletedStepResult> {
    const before = await refreshMemory(), draft = structuredClone(before)
    await applyWriterTable(fieldWriterTable(rootFields), draft, step.mutations)
    const after = await getPlatform().assistant.updateMemorySettings(draft.settings)
    await refreshMemory()
    return { status: 'completed', resultingRevisions: { memory_settings: after.revision }, directRefs: [rootRef], evidence: [{ kind: 'entity_state', target: rootRef, fact: '记忆设置已保存。', capturedAt: new Date().toISOString() }], undoToken: JSON.stringify(before.settings) }
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const after = await getPlatform().assistant.updateMemorySettings(z.object({ enabled: z.boolean(), autoOrganize: z.boolean() }).parse(JSON.parse(token)))
    await refreshMemory()
    return { status: 'completed', resultingRevisions: { memory_settings: after.revision }, directRefs: [rootRef], evidence: [] }
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult) { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
