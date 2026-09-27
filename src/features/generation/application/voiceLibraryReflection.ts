import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationPlannedStep, type ApplicationEntityRegistration, type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue, unrestrictedCollectionAvailability } from '@/core/application-control'
import { voiceLibraryService, type VoiceLibraryRecord } from '@/services/voiceLibrary/VoiceLibraryService'

const entityType = 'generation.voice'
const reason = '音色由正式生成任务创建；状态随训练查询和正式合成更新，不允许伪造供应商音色。'
const schemaRef = (kind: 'entity' | 'property', id: string) => {
  const hash = [...`${kind}:${id}`].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${hash.padEnd(64, hash).slice(0, 64)}` }
}
const refFor = (voice: VoiceLibraryRecord): ApplicationRef => ({ kind: entityType, id: encodeURIComponent(JSON.stringify([voice.providerId, voice.modelId ?? '', voice.voiceId])), label: voice.voiceName })
const revision = (records: VoiceLibraryRecord[]): number => [...JSON.stringify(records)].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 5381)
const fields = [
  ['voice_id', '合成音色', { kind: 'string', maxLength: 256 }],
  ['name', '音色名称', { kind: 'string', maxLength: 200 }],
  ['provider_id', '供应商', { kind: 'string', maxLength: 120 }],
  ['model_id', '适用模型', { kind: 'string', maxLength: 200 }],
  ['status', '训练状态', { kind: 'string', maxLength: 40 }],
  ['expires_at', '未激活有效期', { kind: 'string', maxLength: 80 }],
] as const

function values(voice: VoiceLibraryRecord): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries({ voice_id: voice.voiceId, name: voice.voiceName, provider_id: voice.providerId, model_id: voice.modelId ?? '', status: !voice.activated && voice.expiresAt && Date.parse(voice.expiresAt) <= Date.now() ? 'expired_or_needs_refresh' : voice.status ?? 'ready', expires_at: voice.activated ? '' : voice.expiresAt ?? '' }).map(([key, value]) => [`${entityType}.${key}`, value]))
}

/** Model parameters and saved voices share the same provider/model identities used by the selector. */
export function createVoiceLibraryReflectionRegistration(): ApplicationEntityRegistration {
  const properties: ApplicationPropertyDescriptor[] = fields.map(([key, title, value]) => ({
    id: `${entityType}.${key}`, entityType, version: 1, title, description: title, value,
    nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['generation:read'], write: [] }, revisionScopes: ['generation'],
    schemaRef: schemaRef('property', `${entityType}.${key}`), readOnlyReason: reason,
  }))
  return {
    entity: { id: entityType, version: 1, domain: 'generation', title: '克隆音色库', description: '读取已保存的音色与训练状态；合成时将 voice_id 填入对应模型的音色参数。移除仅删除本地记录，不删除供应商音色或取消费用。新音色必须通过正式克隆任务创建。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['generation.model'], revisionScopes: ['generation'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType), collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 1 } },
    properties,
    provider: {
      entityType,
      async listEntities(request) {
        const records = await voiceLibraryService.listVoices()
        const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
        const page = records.slice(offset, offset + request.limit)
        return { refs: page.map(refFor), nextCursor: offset + page.length < records.length ? String(offset + page.length) : null, revisions: { generation: revision(records) } }
      },
      async readEntity(ref, request) {
        const records = await voiceLibraryService.listVoices()
        const voice = records.find(item => refFor(item).id === ref.id)
        if (ref.kind !== entityType || !voice) throw new Error('NOT_FOUND')
        return { ref, entityType, revisions: { generation: revision(records) }, properties: Object.fromEntries(Object.entries(values(voice)).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), capturedAt: new Date().toISOString() }
      },
      async getPropertyAvailability(ref, propertyIds) {
        const records = await voiceLibraryService.listVoices()
        if (ref.kind !== entityType || !records.some(item => refFor(item).id === ref.id)) throw new Error('NOT_FOUND')
        return propertyIds.map(propertyId => {
          if (!properties.some(item => item.id === propertyId)) throw new Error('PROPERTY_NOT_FOUND')
          return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['generation:read'], revisions: { generation: revision(records) } }
        })
      },
      async getCollectionAvailability(parent) {
        const records = await voiceLibraryService.listVoices()
        const available = unrestrictedCollectionAvailability(entityType, parent, { generation: revision(records) }, ['generation:write'])
        available.create = { ...available.create, available: false, reasons: [reason] }
        if (parent.kind !== 'generation.model') available.remove = { ...available.remove, available: false, reasons: ['请选择音色所属模型。'] }
        return available
      },
    },
  }
}

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
const removedVoices = new Map<string, VoiceLibraryRecord>()
export class VoiceLibraryCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = entityType
  readonly effectContract = { direct: [], cascades: [] }
  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== 'generation.model' || step.operation.kind !== 'remove' || step.operation.targets.length !== 1) throw new Error('INVALID_INPUT')
    const target = step.operation.targets[0]
    const records = await voiceLibraryService.listVoices()
    const voice = records.find(item => target.kind === entityType && refFor(item).id === target.id && item.modelId === step.parent.id)
    if (!voice) throw new Error('NOT_FOUND')
    await voiceLibraryService.deleteVoice(voice.voiceId, { providerId: voice.providerId, modelId: voice.modelId })
    const token = crypto.randomUUID()
    removedVoices.set(token, voice)
    return { status: 'completed', directRefs: [target], resultingRevisions: { generation: revision(await voiceLibraryService.listVoices()) }, undoToken: token,
      evidence: [{ kind: 'operation_result', target, fact: '已移除本地音色记录；供应商音色未删除。', capturedAt: new Date().toISOString() }] }
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const voice = removedVoices.get(token)
    if (!voice) throw new Error('UNDO_NOT_FOUND')
    const records = await voiceLibraryService.listVoices()
    if (records.some(item => refFor(item).id === refFor(voice).id)) throw new Error('CONFLICT:音色记录已重新创建，不能覆盖')
    await voiceLibraryService.upsertVoice(voice)
    removedVoices.delete(token)
    return { status: 'completed', directRefs: [refFor(voice)], resultingRevisions: { generation: revision(await voiceLibraryService.listVoices()) },
      evidence: [{ kind: 'entity_state', target: refFor(voice), fact: '音色记录已恢复。', capturedAt: new Date().toISOString() }] }
  }
  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult) { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
