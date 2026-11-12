import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationExecutionContext,
  ApplicationEvidence,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
  ApplicationRef,
} from '@/core/application-control'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { addAudioEditCut, removeAudioEditCuts } from '@/core/audioEdit/edits'
import { applyWriterTable, writableProperties, propertyOperations } from '@/core/application-control/execution/writerTable'
import { audioEditWriterTable } from './audioEditFields'
import { loadAudioEditProject, editAudioEditProjectAsync, flushAudioEditProject, getAudioEditRevision, restoreAudioEditProjectSnapshot, subscribeAudioEditProjectDisposal } from './audioEditProjectInstances'
import { AUDIO_EDIT_ENTITY_TYPES } from './audioEditReflection'
import { loadAudioEditBreaths } from './audioEditBreaths'
import { describeAudioEditBreaths } from '@/core/audioEdit/breaths'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
type MutableEntityType = typeof AUDIO_EDIT_ENTITY_TYPES.project | typeof AUDIO_EDIT_ENTITY_TYPES.transcriptBlock | typeof AUDIO_EDIT_ENTITY_TYPES.cut | typeof AUDIO_EDIT_ENTITY_TYPES.caption | typeof AUDIO_EDIT_ENTITY_TYPES.suggestion | typeof AUDIO_EDIT_ENTITY_TYPES.breath | typeof AUDIO_EDIT_ENTITY_TYPES.processorChain

const MAX_UNDO_RECORDS = 50
/** after 是写入后的作品：撤销前比较内容，用户之后又改过就不拿旧快照覆盖。 */
const undoRecords = new Map<string, { previous: AudioEditProjectDocument; after: AudioEditProjectDocument; targets: ApplicationRef[] }>()
function clearAudioEditUndoRecords(projectId?: string): void {
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

function retainUndo(previous: AudioEditProjectDocument, after: AudioEditProjectDocument, targets: ApplicationRef[]): string {
  const undoToken = `audio-edit:${crypto.randomUUID()}`
  undoRecords.set(undoToken, { previous, after, targets })
  while (undoRecords.size > MAX_UNDO_RECORDS) undoRecords.delete(undoRecords.keys().next().value!)
  return undoToken
}

async function undoAudioEditRecord(undoToken: string): Promise<ApplicationCompletedStepResult> {
  const record = undoRecords.get(undoToken)
  if (!record) throw new Error('AUDIO_EDIT_UNDO_NOT_FOUND')
  const { previous, after, targets } = record
  await loadAudioEditProject(previous.id)
  const saved = restoreAudioEditProjectSnapshot(previous.id, previous, after)
  await flushAudioEditProject(previous.id)
  undoRecords.delete(undoToken)
  return { status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() }, directRefs: targets.map(target => ({ ...target, revision: saved.revision })), evidence: targets.map(target => ({ kind: 'entity_state', target: { ...target, revision: saved.revision }, fact: '口播剪辑修改已撤销。', capturedAt: new Date().toISOString() })) }
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
    // 写入器只做不可变更新：草稿从当前作品出发，没改的部分沿用原引用，提交时不必整份复制和重新校验
    const { previous, saved } = await editAudioEditProjectAsync(ids.projectId, async (current) => {
      const raw = this.entityType === AUDIO_EDIT_ENTITY_TYPES.breath ? await loadAudioEditBreaths(current) : undefined
      const draft = { document: current, childId: ids.childId, ...(raw ? { breaths: { raw, views: describeAudioEditBreaths(current, raw) } } : {}) }
      await applyWriterTable(audioEditWriterTable(this.entityType), draft, step.mutations)
      return draft.document
    })
    if (!context?.persistenceScopes?.has(`audio_edit:${ids.projectId}`)) await flushAudioEditProject(ids.projectId)
    return {
      status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() },
      directRefs: [{ kind: this.entityType, id: step.target.id, revision: saved.revision }],
      evidence: step.mutations.map((mutation) => ({ kind: 'property_value' as const, target: { kind: this.entityType, id: step.target.id, revision: saved.revision }, fact: `口播剪辑属性 ${mutation.propertyId} 已更新。`, data: mutation.value ?? null, capturedAt: new Date().toISOString() })),
      undoToken: retainUndo(previous, saved, [{ kind: this.entityType, id: step.target.id }]),
    }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> { return undoAudioEditRecord(undoToken) }
}

const CUT = AUDIO_EDIT_ENTITY_TYPES.cut

function cutFrame(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_VALUE:${field} 必须是非负整数采样帧。`)
  return value
}

/** 逐条增删剪切：只加上或去掉点名的那几处，其余剪切保持原样，和逐条修改一样不会整组覆盖。 */
export class AudioEditCutCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CUT
  readonly effectContract = { direct: [], cascades: [] }

  async apply(step: CollectionStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== AUDIO_EDIT_ENTITY_TYPES.project) throw new Error(`剪切属于口播：parent 请用 { kind: '${AUDIO_EDIT_ENTITY_TYPES.project}', id: 口播文档 ID }。`)
    const projectId = step.parent.id
    let refs: ApplicationRef[] = []
    const { previous, saved } = await editAudioEditProjectAsync(projectId, async (current) => {
      refs = []
      if (step.operation.kind === 'create') {
        let next = current
        for (const item of step.operation.items) {
          const mode = item.properties[`${CUT}.mode`]
          if (mode !== undefined && mode !== 'delete' && mode !== 'mute') throw new Error('INVALID_VALUE:mode 只能写 delete 或 mute。')
          const enabled = item.properties[`${CUT}.enabled`]
          if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('INVALID_VALUE:enabled 必须是布尔值。')
          const added = addAudioEditCut(next, { startFrame: cutFrame(item.properties[`${CUT}.start_frame`], 'start_frame'), endFrame: cutFrame(item.properties[`${CUT}.end_frame`], 'end_frame') }, { ...(mode ? { mode } : {}), ...(enabled !== undefined ? { enabled } : {}) })
          next = added.project
          refs.push({ kind: CUT, id: `${projectId}:${added.id}` })
        }
        return next
      }
      const ids = step.operation.targets.map((target) => {
        const { projectId: owner, childId } = splitTarget(CUT, target.id)
        if (target.kind !== CUT || owner !== projectId) throw new Error('只能删除这份口播里的剪切。')
        refs.push({ kind: CUT, id: target.id })
        return childId
      })
      return removeAudioEditCuts(current, ids)
    })
    if (!context.persistenceScopes?.has(`audio_edit:${projectId}`)) await flushAudioEditProject(projectId)
    return {
      status: 'completed', resultingRevisions: { audio_edit: getAudioEditRevision() },
      directRefs: refs.map(ref => ({ ...ref, revision: saved.revision })),
      evidence: refs.map(ref => ({ kind: 'entity_state' as const, target: { ...ref, revision: saved.revision }, fact: step.operation.kind === 'create' ? '已添加这处剪切。' : '已去掉这处剪切。', capturedAt: new Date().toISOString() })),
      undoToken: retainUndo(previous, saved, refs),
    }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await undoAudioEditRecord(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> { return undoAudioEditRecord(undoToken) }
}
