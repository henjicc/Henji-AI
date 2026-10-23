import { applyWriterTable, propertyOperations, writableProperties, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationMutationExecutor, type ApplicationPlannedStep } from '@/core/application-control'
import { getPlatform } from '@/platform'
import { WEB_RECORDING_TYPE } from './webAppRecordingCollectionExecutor'
import { webRecordingWriterTable } from './webAppRecordingFields'

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
const writers = webRecordingWriterTable

/** Renaming a web recording through the generic property verb; the recording page's rename uses the same service. */
export class WebRecordingMutation implements ApplicationMutationExecutor {
  readonly entityType = WEB_RECORDING_TYPE
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(writers)
  readonly propertyOperations = propertyOperations(writers)
  private readonly undoRecords = new Map<string, { id: string; before: string | null }>()
  private result(id: string, title: string): ApplicationCompletedStepResult {
    const ref = { kind: this.entityType, id }
    return { status: 'completed', resultingRevisions: { screen_recording: 0 }, directRefs: [ref], evidence: [{ kind: 'entity_state', target: ref, fact: `网页录制已命名为「${title}」。`, capturedAt: new Date().toISOString() }] }
  }
  async apply(step: Step, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const draft: { title?: string | null } = {}
    await applyWriterTable(writers, draft, step.mutations)
    const platform = getPlatform().webReplay
    const recording = (await platform.recordings()).find(item => item.id === step.target.id)
    if (!recording) throw new Error('没有找到这段网页录制，请重新列出 screen_recording.web_recording')
    if (!draft.title) throw new Error('请提供新名称。')
    await platform.rename([{ recordingId: recording.id, title: draft.title }])
    const undoToken = `web-recording-name:${crypto.randomUUID()}`
    this.undoRecords.set(undoToken, { id: recording.id, before: recording.title ?? null })
    return { ...this.result(recording.id, draft.title), undoToken }
  }
  async undo(token: string, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    context.signal?.throwIfAborted()
    const record = this.undoRecords.get(token)
    if (!record) throw new Error('撤销记录已释放。')
    await getPlatform().webReplay.rename([{ recordingId: record.id, title: record.before }])
    this.undoRecords.delete(token)
    return this.result(record.id, record.before ?? '默认名称')
  }
  forget(token: string): void { this.undoRecords.delete(token) }
  async compensate(_step: Step, result: ApplicationCompletedStepResult, context: ApplicationExecutionContext): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken, context)).evidence : [] }
}
