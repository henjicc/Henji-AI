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
import { loadAudioEditProject, editAudioEditProject, flushAudioEditProject, getAudioEditRevision, restoreAudioEditProjectSnapshot, audioEditProjectContent, subscribeAudioEditProjectDisposal } from './audioEditProjectInstances'
import { AUDIO_EDIT_ENTITY_TYPES } from './audioEditReflection'
import { loadAudioEditBreaths } from './audioEditBreaths'
import { describeAudioEditBreaths } from '@/core/audioEdit/breaths'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type MutableEntityType = typeof AUDIO_EDIT_ENTITY_TYPES.project | typeof AUDIO_EDIT_ENTITY_TYPES.transcriptBlock | typeof AUDIO_EDIT_ENTITY_TYPES.caption | typeof AUDIO_EDIT_ENTITY_TYPES.suggestion | typeof AUDIO_EDIT_ENTITY_TYPES.breath | typeof AUDIO_EDIT_ENTITY_TYPES.processorChain

const MAX_UNDO_RECORDS = 50
const undoRecords = new Map<string, { previous: AudioEditProjectDocument; afterContent: string; target: { kind: MutableEntityType; id: string } }>()
export function clearAudioEditUndoRecords(projectId?: string): void {
  for (const [token, record] of undoRecords) {
    if (projectId === undefined || record.previous.id === projectId) undoRecords.delete(token)
  }
}
subscribeAudioEditProjectDisposal(clearAudioEditUndoRecords)

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
    const raw = this.entityType === AUDIO_EDIT_ENTITY_TYPES.breath ? await loadAudioEditBreaths(current) : undefined
    const draft = { document: structuredClone(current), childId: ids.childId, ...(raw ? { breaths: { raw, views: describeAudioEditBreaths(current, raw) } } : {}) }
    await applyWriterTable(audioEditWriterTable(this.entityType), draft, step.mutations)
    const saved = editAudioEditProject(ids.projectId, () => draft.document)
    if (!context?.persistenceScopes?.has(`audio_edit:${ids.projectId}`)) await flushAudioEditProject(ids.projectId)
    const undoToken = `audio-edit:${crypto.randomUUID()}`
    undoRecords.set(undoToken, { previous: current, afterContent: audioEditProjectContent(saved), target: { kind: this.entityType, id: step.target.id } })
    while (undoRecords.size > MAX_UNDO_RECORDS) undoRecords.delete(undoRecords.keys().next().value!)
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
    const { previous, afterContent, target } = record
    await loadAudioEditProject(previous.id)
    const saved = restoreAudioEditProjectSnapshot(previous.id, previous, afterContent)
    await flushAudioEditProject(previous.id)
    undoRecords.delete(undoToken)
    return { status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() }, directRefs: [{ ...target, revision: saved.revision }], evidence: [{ kind: 'entity_state', target: { ...target, revision: saved.revision }, fact: '口播剪辑属性修改已撤销。', capturedAt: new Date().toISOString() }] }
  }
}
