import { getPlatform } from '@/platform'
import { z } from 'zod'
import { AUDIO_CAPTURE_CONTROL_EXCLUSION, audioCaptureInventorySchema, audioCaptureSettingsSchema, type AudioCaptureSettings } from '@/core/audioCapture/contracts'
import { applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, writableProperties, propertyOperations, unrestrictedCollectionAvailability,
  type ApplicationCompletedStepResult, type ApplicationEntityRegistration, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { AUDIO_CAPTURE_ENTITY as ENTITY, audioCaptureFields, captureSchemaRef, readCaptureFields } from './audioCaptureFields'
import type { ApplicationDomainModule } from './domainModule'

const target: ApplicationRef = { kind: ENTITY, id: 'singleton', label: '录音设备与参数' }
const assertRef = (ref: ApplicationRef): void => { if (ref.kind !== ENTITY || ref.id !== target.id) throw new Error('录音参数只有一个本机实例 singleton') }
const revisions = (revision: number): Record<string, number> => ({ audio_capture: revision })
function registrations(): ApplicationEntityRegistration[] {
  return [{ entity: { id: ENTITY, domain: 'audio_capture', version: 1, title: '录音设备与参数', description: `本机原生录音偏好，修改只影响下次录音。${AUDIO_CAPTURE_CONTROL_EXCLUSION}`, refKind: ENTITY,
    dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: ['audio_capture'], queryCapabilityIds: ['read_application_entity'], schemaRef: captureSchemaRef('entity', ENTITY) }, properties: fieldDescriptors(audioCaptureFields),
    schemaDocuments: [
      { ref: captureSchemaRef('property', `${ENTITY}.devices.value`), value: z.toJSONSchema(audioCaptureInventorySchema) as JsonValue },
      { ref: captureSchemaRef('property', `${ENTITY}.effective.value`), value: z.toJSONSchema(z.object({ settings: audioCaptureSettingsSchema, notice: z.string().nullable() })) as JsonValue },
    ],
    provider: {
      entityType: ENTITY,
      async listEntities() { return { refs: [target], nextCursor: null, revisions: revisions((await getPlatform().audioCapture.getSettings()).revision) } },
      async readEntity(ref, request) { assertRef(ref); const source = await readCaptureFields(); const all = fieldReadValues(audioCaptureFields, source); return { ref: target, entityType: ENTITY, revisions: revisions(source.state.revision), properties: request.propertyIds ? Object.fromEntries(Object.entries(all).filter(([id]) => request.propertyIds!.includes(id))) : all, capturedAt: new Date().toISOString() } },
      async getPropertyAvailability(ref, ids) {
        assertRef(ref); const state = await getPlatform().audioCapture.getSettings()
        return ids.map(propertyId => { const field = audioCaptureFields.find(f => f.propertyId === propertyId); if (!field) throw new Error(`未知录音属性：${propertyId}`)
          return { propertyId, readable: true, writable: !!field.writer, reasons: field.writer ? [] : [field.descriptor.readOnlyReason!], requiredPermissions: ['settings:read'], revisions: revisions(state.revision) } })
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(ENTITY, parent, revisions((await getPlatform().audioCapture.getSettings()).revision), ['settings:write']) },
    } }]
}
type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
export class AudioCaptureMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  readonly table = fieldWriterTable(audioCaptureFields)
  readonly writableProperties = writableProperties(this.table)
  readonly propertyOperations = propertyOperations(this.table)
  private readonly undos = new Map<string, { before: AudioCaptureSettings; after: AudioCaptureSettings }>()
  private completed(revision: number, undoToken?: string): ApplicationCompletedStepResult { return { status: 'completed', directRefs: [target], resultingRevisions: revisions(revision), ...(undoToken ? { undoToken } : {}), evidence: [{ kind: 'entity_state', fact: '录音设置已保存并从主进程读回。', capturedAt: new Date().toISOString() }] } }
  async apply(step: Step): Promise<ApplicationCompletedStepResult> {
    assertRef(step.target); const api = getPlatform().audioCapture; const before = await api.getSettings()
    const draft = { settings: { ...before.settings } }; await applyWriterTable(this.table, draft, step.mutations)
    const after = await api.setSettings(draft.settings, before.revision)
    const token = crypto.randomUUID(); this.undos.set(token, { before: before.settings, after: after.settings })
    while (this.undos.size > 128) this.undos.delete(this.undos.keys().next().value!)
    return this.completed(after.revision, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const undo = this.undos.get(token); if (!undo) throw new Error('录音设置撤销记录已失效')
    const api = getPlatform().audioCapture; const current = await api.getSettings()
    if (JSON.stringify(current.settings) !== JSON.stringify(undo.after)) throw new Error('录音设置已被其他操作修改，请读取当前设置后再调整')
    const after = await api.setSettings(undo.before, current.revision); this.undos.delete(token); return this.completed(after.revision)
  }
  async compensate(_step: Step, result: ApplicationCompletedStepResult): Promise<[]> { if (result.undoToken) await this.undo(result.undoToken); return [] }
  forget(token: string): void { this.undos.delete(token) }
}
export const audioCaptureApplicationDomain: ApplicationDomainModule = { id: 'audio_capture', entities: registrations, registerExecutors(engine) { engine.registerMutationExecutor(new AudioCaptureMutationExecutor()) }, registerCapabilities() {} }
