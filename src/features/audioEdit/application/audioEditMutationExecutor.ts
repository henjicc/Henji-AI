import type {
  ApplicationCompletedStepResult,
  ApplicationExecutionContext,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
} from '@/core/application-control'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { applyWriterTable, writableProperties, propertyOperations } from '@/core/application-control/execution/writerTable'
import { audioEditWriterTable } from './audioEditFields'
import { loadAudioEditProject, editAudioEditProject, flushAudioEditProject, getAudioEditRevision } from './audioEditProjectInstances'
import { AUDIO_EDIT_ENTITY_TYPES } from './audioEditReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type MutableEntityType = typeof AUDIO_EDIT_ENTITY_TYPES.project | typeof AUDIO_EDIT_ENTITY_TYPES.transcriptBlock | typeof AUDIO_EDIT_ENTITY_TYPES.suggestion | typeof AUDIO_EDIT_ENTITY_TYPES.processorChain

const undoRecords = new Map<string, { previous: AudioEditProjectDocument; after: AudioEditProjectDocument }>()

function splitTarget(entityType: MutableEntityType, id: string): { projectId: string; childId: string } {
  if (entityType === AUDIO_EDIT_ENTITY_TYPES.project || entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain) return { projectId: id, childId: '' }
  const separator = id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: id.slice(0, separator), childId: id.slice(separator + 1) }
}

export class AudioEditMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties: ReadonlySet<string>
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>

  constructor(readonly entityType: MutableEntityType) {
    const table = audioEditWriterTable(entityType)
    this.writableProperties = writableProperties(table)
    this.propertyOperations = propertyOperations(table)
  }

  async apply(step: MutationStep, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const ids = splitTarget(this.entityType, step.target.id)
    const current = (await loadAudioEditProject(ids.projectId)).document
    const draft = { document: structuredClone(current), childId: ids.childId }
    await applyWriterTable(audioEditWriterTable(this.entityType), draft, step.mutations)
    const saved = editAudioEditProject(ids.projectId, () => draft.document)
    if (!context?.persistenceScopes?.has(`audio_edit:${ids.projectId}`)) await flushAudioEditProject(ids.projectId)
    const undoToken = `audio-edit:${crypto.randomUUID()}`
    undoRecords.set(undoToken, { previous: current, after: saved })
    return {
      status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() },
      directRefs: [{ kind: this.entityType, id: step.target.id, revision: saved.revision }],
      evidence: step.mutations.map((mutation) => ({ kind: 'property_value' as const, target: { kind: this.entityType, id: step.target.id, revision: saved.revision }, fact: `口播剪辑属性 ${mutation.propertyId} 已更新。`, data: mutation.value ?? null, capturedAt: new Date().toISOString() })),
      undoToken,
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const record = undoRecords.get(undoToken)
    if (!record) throw new Error('AUDIO_EDIT_UNDO_NOT_FOUND')
    const { previous, after } = record
    const instance = await loadAudioEditProject(previous.id)
    const content = (document: AudioEditProjectDocument) => JSON.stringify({ ...document, revision: 0, updatedAt: 0 })
    if (content(instance.document) !== content(after)) throw new Error('口播已有后续修改，请使用口播撤销逐步恢复。')
    const saved = editAudioEditProject(previous.id, (current) => ({ ...previous, source: current.source }))
    await flushAudioEditProject(previous.id)
    undoRecords.delete(undoToken)
    return { status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() }, directRefs: [{ kind: this.entityType, id: previous.id, revision: saved.revision }], evidence: [{ kind: 'entity_state', target: { kind: this.entityType, id: previous.id, revision: saved.revision }, fact: '口播剪辑属性修改已撤销。', capturedAt: new Date().toISOString() }] }
  }
}
