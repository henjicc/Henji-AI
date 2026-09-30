import { fieldEffectContract, fieldWriterTable, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationRef, type ApplicationExecutionContext } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { VIDEO_EDIT_FIELDS } from './videoEditFields'
import { readVideoEditData, splitVideoEditRef } from './videoEditReflection'
import { videoEditDomainRevision, requireVideoEditInstance } from './videoEditService'
import { readVideoEditSource, updateVideoEditSource, videoEditSourceCommandIdentity, matchesVideoEditSourceCommand, restoreVideoEditSourceCommandIdentity, type VideoEditSourceCommandIdentity, type VideoEditSourceRequest } from './videoEditSource'

const records = new Map<string, { target: ApplicationRef; owner: object; before: VideoEditSourceRequest; beforeCommand: VideoEditSourceCommandIdentity; afterCommand: VideoEditSourceCommandIdentity }>()
function complete(target: ApplicationRef, undoToken?: string): ApplicationCompletedStepResult {
  return { status: 'completed', resultingRevisions: { video_edit: videoEditDomainRevision() }, directRefs: [target], ...(undoToken ? { undoToken } : {}), evidence: [{ kind: 'entity_state', fact: '源预览已由实际媒体宿主确认；可回读实际播放与画面位置。', capturedAt: new Date().toISOString() }] }
}
export class VideoEditSourceExecutor implements ApplicationMutationExecutor {
  readonly entityType = 'video_edit.source'
  readonly effectContract = fieldEffectContract(VIDEO_EDIT_FIELDS[this.entityType])
  readonly writableProperties = writableProperties(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]))
  readonly propertyOperations = propertyOperations(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]))
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const { projectId } = splitVideoEditRef(step.target)
    const owner = requireVideoEditInstance(projectId)
    const before = readVideoEditSource(projectId)
    const beforeCommand = videoEditSourceCommandIdentity(projectId)
    const data = readVideoEditData(step.target)
    await applyWriterTable(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]), data, step.mutations)
    const keys = step.mutations.map(mutation => mutation.propertyId)
    await updateVideoEditSource(projectId, {
      ...(keys.includes('video_edit.source.item_id') ? { itemId: String(data.itemId) } : {}),
      ...(keys.includes('video_edit.source.time_us') ? { timeUs: Number(data.timeUs) } : {}),
      ...(keys.includes('video_edit.source.playing') ? { playing: Boolean(data.playing) } : {}),
      ...(keys.includes('video_edit.source.volume') ? { volume: Number(data.volume) } : {}),
    }, context.signal)
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程会话已关闭。')
    const token = crypto.randomUUID(); records.set(token, { target: step.target, owner, before, beforeCommand, afterCommand: videoEditSourceCommandIdentity(projectId) })
    while (records.size > 32) records.delete(records.keys().next().value!)
    return complete(step.target, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const record = records.get(token)
    if (!record) throw new Error('源预览撤销记录已过期。')
    const { projectId } = splitVideoEditRef(record.target)
    if (requireVideoEditInstance(projectId) !== record.owner || !matchesVideoEditSourceCommand(projectId, record.afterCommand)) throw new Error('源预览已有后续操作或工程已重开，请按当前状态操作。')
    await updateVideoEditSource(projectId, { itemId: record.before.itemId, timeUs: record.before.timeUs, playing: record.before.playing, volume: record.before.volume })
    restoreVideoEditSourceCommandIdentity(projectId, videoEditSourceCommandIdentity(projectId), record.beforeCommand)
    records.delete(token); return complete(record.target)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await this.undo(result.undoToken)).evidence : [] }
}
