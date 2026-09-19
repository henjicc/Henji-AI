import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
} from '@/core/application-control'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'
import { useAudioEditStore } from '../store/audioEditStore'
import { AUDIO_EDIT_ENTITY_TYPES } from './audioEditReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type MutableEntityType = typeof AUDIO_EDIT_ENTITY_TYPES.project | typeof AUDIO_EDIT_ENTITY_TYPES.transcriptBlock | typeof AUDIO_EDIT_ENTITY_TYPES.suggestion | typeof AUDIO_EDIT_ENTITY_TYPES.processorChain

const undoRecords = new Map<string, AudioEditProjectDocument>()
const SET_ONLY: ReadonlySet<ApplicationMutationOperation> = new Set(['set'])

function splitTarget(entityType: MutableEntityType, id: string): { projectId: string; childId: string } {
  if (entityType === AUDIO_EDIT_ENTITY_TYPES.project || entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain) return { projectId: id, childId: '' }
  const separator = id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: id.slice(0, separator), childId: id.slice(separator + 1) }
}

function booleanValue(value: unknown, propertyId: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`INVALID_VALUE:${propertyId}`)
  return value
}

function stringValue(value: unknown, propertyId: string): string {
  if (typeof value !== 'string') throw new Error(`INVALID_VALUE:${propertyId}`)
  return value
}

function updateLoadedProject(project: AudioEditProjectDocument): void {
  if (useAudioEditStore.getState().project?.id === project.id) {
    useAudioEditStore.getState().setProject(project)
  }
}

export class AudioEditMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties: ReadonlySet<string>
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>

  constructor(readonly entityType: MutableEntityType, properties: string[]) {
    this.writableProperties = new Set(properties)
    this.propertyOperations = new Map(properties.map((propertyId) => [propertyId, SET_ONLY]))
  }

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const ids = splitTarget(this.entityType, step.target.id)
    const current = await getPlatform().audioEdit.getProject(ids.projectId)
    if (!current) throw new Error('NOT_FOUND')
    const next = structuredClone(current)
    for (const mutation of step.mutations) {
      if (mutation.operation !== 'set') throw new Error(`UNSUPPORTED_OPERATION:${mutation.operation}`)
      if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.project) {
        if (mutation.propertyId.endsWith('.name')) next.name = stringValue(mutation.value, mutation.propertyId).trim()
        else if (mutation.propertyId.endsWith('.reference_script')) next.referenceScript = stringValue(mutation.value, mutation.propertyId)
      } else if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.processorChain) {
        next.vstEnabled = booleanValue(mutation.value, mutation.propertyId)
      } else if (this.entityType === AUDIO_EDIT_ENTITY_TYPES.transcriptBlock) {
        next.transcript = next.transcript.map((block) => block.id === ids.childId
          ? mutation.propertyId.endsWith('.included')
            ? { ...block, included: booleanValue(mutation.value, mutation.propertyId) }
            : { ...block, locked: booleanValue(mutation.value, mutation.propertyId) }
          : block)
      } else {
        const status = stringValue(mutation.value, mutation.propertyId)
        if (status !== 'pending' && status !== 'applied' && status !== 'dismissed') throw new Error(`INVALID_VALUE:${mutation.propertyId}`)
        next.suggestions = next.suggestions.map((suggestion) => suggestion.id === ids.childId ? { ...suggestion, status } : suggestion)
      }
    }
    const saved = await getPlatform().audioEdit.saveProject(next)
    updateLoadedProject(saved)
    const undoToken = `audio-edit:${crypto.randomUUID()}`
    undoRecords.set(undoToken, current)
    return {
      status: 'completed', resultingRevisions: { audio_edit: saved.revision },
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
    const previous = undoRecords.get(undoToken)
    if (!previous) throw new Error('AUDIO_EDIT_UNDO_NOT_FOUND')
    const current = await getPlatform().audioEdit.getProject(previous.id)
    if (!current) throw new Error('NOT_FOUND')
    const saved = await getPlatform().audioEdit.saveProject({ ...previous, revision: current.revision })
    undoRecords.delete(undoToken)
    updateLoadedProject(saved)
    return { status: 'completed', resultingRevisions: { audio_edit: saved.revision }, directRefs: [{ kind: this.entityType, id: previous.id, revision: saved.revision }], evidence: [{ kind: 'entity_state', target: { kind: this.entityType, id: previous.id, revision: saved.revision }, fact: '口播剪辑属性修改已撤销。', capturedAt: new Date().toISOString() }] }
  }
}
