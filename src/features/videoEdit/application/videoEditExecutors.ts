import { fieldWriterTable, type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationEvidence, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { videoEditAnnotationSchema, videoEditClipSchema, type VideoEditDocument } from '@/core/videoEdit/document'
import { editVideoProject, requireVideoEditInstance, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_FIELDS, videoEditDataKey, type VideoEditEntityType } from './videoEditFields'
import { readVideoEditData, splitVideoEditRef } from './videoEditReflection'

const undo = new Map<string, { before: VideoEditDocument; after: VideoEditDocument }>()
function content(document: VideoEditDocument): string { return JSON.stringify({ ...document, revision: 0 }) }
function completed(before: VideoEditDocument, after: VideoEditDocument, refs: ApplicationRef[]): ApplicationCompletedStepResult {
  const undoToken = crypto.randomUUID(); undo.set(undoToken, { before, after })
  while (undo.size > 100) undo.delete(undo.keys().next().value!)
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: refs, undoToken, evidence: [{ kind: 'entity_state', fact: '剪辑工程已修改，可由同一工程历史撤销。', capturedAt: new Date().toISOString() }] }
}
async function restore(token: string): Promise<ApplicationCompletedStepResult> {
  const record = undo.get(token); if (!record) throw new Error('撤销记录已过期，请使用工程撤销。')
  const instance = requireVideoEditInstance(record.before.id)
  if (content(instance.document) !== content(record.after)) throw new Error('工程已有后续修改，请逐步撤销。')
  editVideoProject(record.before.id, () => record.before); undo.delete(token)
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: [{ kind: 'video_edit.project', id: record.before.id }], evidence: [{ kind: 'entity_state', fact: '已恢复修改前工程内容。', capturedAt: new Date().toISOString() }] }
}
export class VideoEditMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties
  readonly propertyOperations
  constructor(readonly entityType: VideoEditEntityType) { const table = fieldWriterTable(VIDEO_EDIT_FIELDS[entityType]); this.writableProperties = writableProperties(table); this.propertyOperations = propertyOperations(table) }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>): Promise<ApplicationCompletedStepResult> {
    const { projectId, childId } = splitVideoEditRef(step.target)
    const before = requireVideoEditInstance(projectId).document
    const data = readVideoEditData(step.target)
    await applyWriterTable(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]), data, step.mutations)
    const after = editVideoProject(projectId, document => {
      if (this.entityType === 'video_edit.project') return { ...document, name: String(data.name) }
      if (this.entityType === 'video_edit.clip') return { ...document, clips: document.clips.map(clip => clip.id === childId ? videoEditClipSchema.parse(data) : clip) }
      return { ...document, annotations: document.annotations.map(mark => mark.id === childId ? videoEditAnnotationSchema.parse(data) : mark) }
    })
    return completed(before, after, [step.target])
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
export class VideoEditCollectionExecutor implements ApplicationCollectionExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  constructor(readonly entityType: 'video_edit.clip' | 'video_edit.annotation') {}
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== 'video_edit.project') throw new Error('请使用所属剪辑工程作为父实体。')
    const instance = requireVideoEditInstance(step.parent.id); const before = instance.document
    const refs: ApplicationRef[] = []
    const after = editVideoProject(before.id, document => {
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          const values: Record<string, JsonValue> = Object.fromEntries(Object.entries(item.properties).map(([key, value]) => [videoEditDataKey(key.slice(this.entityType.length + 1)), value]))
          const id = crypto.randomUUID()
          if (this.entityType === 'video_edit.clip') {
            document.clips.push(videoEditClipSchema.parse({ id, track: 1, start: instance.frame, duration: document.fps * 3, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '', ...values }))
          } else document.annotations.push(videoEditAnnotationSchema.parse({ id, frame: instance.frame, kind: 'point', space: 'composition-normalized', x: 0.5, y: 0.5, width: 0, height: 0, ...values }))
          refs.push({ kind: this.entityType, id: `${before.id}:${id}` })
        }
      } else {
        const ids = step.operation.targets.map(ref => { const parsed = splitVideoEditRef(ref); if (parsed.projectId !== before.id) throw new Error('目标不属于此剪辑工程。'); readVideoEditData(ref); return parsed.childId })
        if (this.entityType === 'video_edit.clip') {
          if (document.annotations.some(mark => ids.includes(mark.clipId))) throw new Error('片段仍有标注，请先移除其 video_edit.annotation 实体，再删除片段。')
          document.clips = document.clips.filter(clip => !ids.includes(clip.id))
        } else document.annotations = document.annotations.filter(mark => !ids.includes(mark.id))
        refs.push(...step.operation.targets)
      }
      return document
    })
    return completed(before, after, refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
