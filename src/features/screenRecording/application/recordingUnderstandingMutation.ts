import { applyWriterTable, propertyOperations, writableProperties, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationMutationExecutor, type ApplicationPlannedStep } from '@/core/application-control'
import type { RecordingUnderstanding } from '@/core/screenRecording/understanding'
import { UNDERSTANDING_ENTITY, understandingWriterTable } from './recordingUnderstandingFields'
import { readRecordingUnderstanding, saveRecordingUnderstanding } from './recordingUnderstandingService'

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
export class RecordingUnderstandingMutation implements ApplicationMutationExecutor {
  readonly entityType = UNDERSTANDING_ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(understandingWriterTable)
  readonly propertyOperations = propertyOperations(understandingWriterTable)
  private readonly undoRecords = new Map<string, { id: string; before: RecordingUnderstanding; after: RecordingUnderstanding }>()
  private result(id: string, revision: number): ApplicationCompletedStepResult {
    const ref = { kind: this.entityType, id }
    return { status: 'completed', resultingRevisions: { screen_recording: revision }, directRefs: [ref], evidence: [{ kind: 'entity_state', target: ref, fact: '录制理解已保存并可读回。', capturedAt: new Date().toISOString() }] }
  }
  async apply(step: Step, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const draft: { value?: RecordingUnderstanding } = {}
    await applyWriterTable(understandingWriterTable, draft, step.mutations)
    const read = await readRecordingUnderstanding(step.target.id)
    const expected = step.expectedRevisions.screen_recording
    if (expected !== read.meta.revision) throw new Error('CONFLICT:录制理解已修改，请重新读取。')
    if (!draft.value) throw new Error('请提供完整理解结果。')
    context.signal?.throwIfAborted()
    const revision = await saveRecordingUnderstanding(step.target.id, draft.value, expected)
    const undoToken = `recording:${crypto.randomUUID()}`
    this.undoRecords.set(undoToken, { id: step.target.id, before: read.content.understanding, after: draft.value })
    return { ...this.result(step.target.id, revision), undoToken }
  }
  async undo(token: string, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const record = this.undoRecords.get(token)
    if (!record) throw new Error('撤销记录已释放。')
    const read = await readRecordingUnderstanding(record.id)
    if (JSON.stringify(read.content.understanding) !== JSON.stringify(record.after)) throw new Error('理解结果已有后续修改，请先撤销后续修改。')
    const revision = await saveRecordingUnderstanding(record.id, record.before, read.meta.revision)
    this.undoRecords.delete(token)
    return this.result(record.id, revision)
  }
  forget(token: string): void { this.undoRecords.delete(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult, context: ApplicationExecutionContext): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken, context)).evidence : [] }
}
