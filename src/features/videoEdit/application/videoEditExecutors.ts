import { fieldEffectContract, fieldWriterTable, type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationEffectReceipt, type ApplicationEvidence, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { videoEditAnnotationSchema, videoEditClipSchema, videoEditBinSchema, videoEditItemSchema, videoEditTrackSchema, createVideoEditSequence, changeVideoEditSequenceSettings, type VideoEditDocument } from '@/core/videoEdit/document'
import { editVideoProject, requireVideoEditInstance, videoEditDomainRevision as videoEditRevision } from './videoEditService'
import { VIDEO_EDIT_FIELDS, videoEditDataKey, type VideoEditEntityType } from './videoEditFields'
import { readVideoEditData, splitVideoEditRef } from './videoEditReflection'

const undo = new Map<string, { before: VideoEditDocument; after: VideoEditDocument; refs: ApplicationRef[] }>()
function cascades(before: VideoEditDocument, after: VideoEditDocument): ApplicationEffectReceipt[] {
  const effects: ApplicationEffectReceipt[] = []
  for (const sequence of after.sequences) {
    const previous = before.sequences.find(item => item.id === sequence.id)
    if (!previous || previous.frameRate.numerator * sequence.frameRate.denominator === sequence.frameRate.numerator * previous.frameRate.denominator) continue
    const clips = sequence.clips.filter(clip => previous.clips.some(item => item.id === clip.id && (clip.start !== item.start || clip.duration !== item.duration)))
    const marks = sequence.annotations.filter(mark => previous.annotations.some(item => item.id === mark.id && mark.frame !== item.frame))
    for (const [items, entityType, propertyIds, declarationId] of [
      [clips, 'video_edit.clip', ['video_edit.clip.start', 'video_edit.clip.duration'], 'video_edit.sequence_clip_time'],
      [marks, 'video_edit.annotation', ['video_edit.annotation.frame'], 'video_edit.sequence_annotation_time'],
    ] as const) for (let offset = 0; offset < items.length; offset += 256) effects.push({ effect: 'update', entityType, propertyIds: [...propertyIds], refs: items.slice(offset, offset + 256).map(item => ({ kind: entityType, id: `${after.id}:${item.id}` })), origin: { kind: 'cascade', declarationId } })
  }
  for (const effect of ['create', 'delete'] as const) {
    const from = effect === 'create' ? before : after; const to = effect === 'create' ? after : before
    const oldTracks = new Set(from.sequences.flatMap(sequence => sequence.tracks.map(track => track.id)))
    const tracks = to.sequences.flatMap(sequence => sequence.tracks).filter(track => !oldTracks.has(track.id))
    for (let offset = 0; offset < tracks.length; offset += 256) effects.push({ effect, entityType: 'video_edit.track', propertyIds: [], refs: tracks.slice(offset, offset + 256).map(track => ({ kind: 'video_edit.track', id: `${after.id}:${track.id}` })), origin: { kind: 'cascade', declarationId: `video_edit.sequence_tracks_${effect}` } })
  }
  return effects
}
function content(document: VideoEditDocument): string { return JSON.stringify({ ...document, revision: 0 }) }
function completed(before: VideoEditDocument, after: VideoEditDocument, refs: ApplicationRef[]): ApplicationCompletedStepResult {
  const undoToken = crypto.randomUUID(); undo.set(undoToken, { before, after, refs })
  while (undo.size > 100) undo.delete(undo.keys().next().value!)
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: refs, undoToken, cascadeEffects: cascades(before, after), evidence: [{ kind: 'entity_state', fact: '剪辑工程已修改，可由同一工程历史撤销。', capturedAt: new Date().toISOString() }] }
}
async function restore(token: string): Promise<ApplicationCompletedStepResult> {
  const record = undo.get(token); if (!record) throw new Error('撤销记录已过期，请使用工程撤销。')
  const instance = requireVideoEditInstance(record.before.id)
  if (content(instance.document) !== content(record.after)) throw new Error('工程已有后续修改，请逐步撤销。')
  editVideoProject(record.before.id, () => record.before); undo.delete(token)
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: record.refs, cascadeEffects: cascades(record.after, record.before), evidence: [{ kind: 'entity_state', fact: '已恢复修改前工程内容。', capturedAt: new Date().toISOString() }] }
}
export class VideoEditMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract
  readonly writableProperties
  readonly propertyOperations
  constructor(readonly entityType: VideoEditEntityType) { const table = fieldWriterTable(VIDEO_EDIT_FIELDS[entityType]); this.writableProperties = writableProperties(table); this.propertyOperations = propertyOperations(table); this.effectContract = fieldEffectContract(VIDEO_EDIT_FIELDS[entityType]) }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>): Promise<ApplicationCompletedStepResult> {
    const { projectId, childId } = splitVideoEditRef(step.target)
    const before = requireVideoEditInstance(projectId).document
    const data = readVideoEditData(step.target)
    await applyWriterTable(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]), data, step.mutations)
    if (this.entityType === 'video_edit.clip' && step.mutations.some(mutation => mutation.propertyId === 'video_edit.clip.source_in_us')) data.sourceRemainder = { numerator: 0, denominator: 1 }
    const after = editVideoProject(projectId, document => {
      if (this.entityType === 'video_edit.project') return { ...document, name: String(data.name) }
      if (this.entityType === 'video_edit.bin') return { ...document, bins: document.bins.map(item => item.id === childId ? videoEditBinSchema.parse(data) : item) }
      if (this.entityType === 'video_edit.item') return { ...document, items: document.items.map(item => item.id === childId ? videoEditItemSchema.parse(data) : item) }
      return { ...document, sequences: document.sequences.map(sequence => {
        if (this.entityType === 'video_edit.sequence' && sequence.id === childId) {
          const next = changeVideoEditSequenceSettings(sequence, { width: Number(data.width), height: Number(data.height), frameRate: data.frameRate as typeof sequence.frameRate, pixelAspectRatio: data.pixelAspectRatio as typeof sequence.pixelAspectRatio, sampleRate: data.sampleRate as typeof sequence.sampleRate, channels: data.channels as typeof sequence.channels })
          return { ...next, name: String(data.name) }
        }
        if (this.entityType === 'video_edit.clip') return { ...sequence, clips: sequence.clips.map(clip => clip.id === childId ? videoEditClipSchema.parse(data) : clip) }
        if (this.entityType === 'video_edit.annotation') return { ...sequence, annotations: sequence.annotations.map(mark => mark.id === childId ? videoEditAnnotationSchema.parse(data) : mark) }
        if (this.entityType === 'video_edit.track') return { ...sequence, tracks: sequence.tracks.map(track => track.id === childId ? videoEditTrackSchema.parse(data) : track) }
        return sequence
      }) }
    })
    return completed(before, after, [step.target])
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
export class VideoEditCollectionExecutor implements ApplicationCollectionExecutor {
  readonly effectContract
  constructor(readonly entityType: 'video_edit.sequence' | 'video_edit.bin' | 'video_edit.item' | 'video_edit.clip' | 'video_edit.annotation') {
    this.effectContract = { direct: [], cascades: entityType === 'video_edit.sequence' ? (['create', 'delete'] as const).map(effect => ({ declarationId: `video_edit.sequence_tracks_${effect}`, effect, entityType: 'video_edit.track', propertyIds: [], revisionScopes: ['video_edit'] })) : [] }
  }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>): Promise<ApplicationCompletedStepResult> {
    const nested = this.entityType === 'video_edit.clip' || this.entityType === 'video_edit.annotation'
    if (step.parent.kind !== (nested ? 'video_edit.sequence' : 'video_edit.project')) throw new Error(nested ? '请使用所属剪辑序列作为父实体。' : '请使用所属剪辑工程作为父实体。')
    const parsed = splitVideoEditRef(step.parent)
    const instance = requireVideoEditInstance(parsed.projectId); const before = instance.document
    const refs: ApplicationRef[] = []
    const after = editVideoProject(before.id, document => {
      const sequence = document.sequences.find(sequence => sequence.id === parsed.childId)
      if (nested && !sequence) throw new Error('目标序列不存在。')
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          const values: Record<string, JsonValue> = Object.fromEntries(Object.entries(item.properties).map(([key, value]) => [videoEditDataKey(key.slice(this.entityType.length + 1)), value]))
          const id = crypto.randomUUID()
          switch (this.entityType) {
            case 'video_edit.sequence': document.sequences.push({ ...createVideoEditSequence(), ...values, id } as ReturnType<typeof createVideoEditSequence>); break
            case 'video_edit.bin': document.bins.push(videoEditBinSchema.parse({ id, ...values })); break
            case 'video_edit.item': document.items.push(videoEditItemSchema.parse({ id, ...values })); break
            case 'video_edit.clip': sequence!.clips.push(videoEditClipSchema.parse({ id, track: values.kind === 'audio' ? 0 : 1, start: 0, duration: Math.round(sequence!.frameRate.numerator / sequence!.frameRate.denominator * 3), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '', ...values })); break
            case 'video_edit.annotation': sequence!.annotations.push(videoEditAnnotationSchema.parse({ id, frame: 0, kind: 'point', space: 'composition-normalized', x: 0.5, y: 0.5, width: 0, height: 0, ...values })); break
          }
          refs.push({ kind: this.entityType, id: `${before.id}:${id}` })
        }
      } else {
        const ids = step.operation.targets.map(ref => { const target = splitVideoEditRef(ref); if (target.projectId !== before.id || ref.kind !== this.entityType) throw new Error('目标不属于此剪辑工程或集合。'); readVideoEditData(ref); return target.childId })
        switch (this.entityType) {
          case 'video_edit.sequence':
            if (document.sequences.some(sequence => ids.includes(sequence.id) && (sequence.clips.length || sequence.annotations.length))) throw new Error('请先移除序列内的片段和标注，再移除序列。')
            document.sequences = document.sequences.filter(sequence => !ids.includes(sequence.id)); break
          case 'video_edit.bin': document.bins = document.bins.filter(bin => !ids.includes(bin.id)); break
          case 'video_edit.item': document.items = document.items.filter(item => !ids.includes(item.id)); break
          case 'video_edit.clip':
            if (ids.some(id => !sequence!.clips.some(clip => clip.id === id))) throw new Error('片段不属于目标序列。')
            if (sequence!.annotations.some(mark => ids.includes(mark.clipId))) throw new Error('片段仍有标注，请先移除标注，再删除片段。')
            sequence!.clips = sequence!.clips.filter(clip => !ids.includes(clip.id)); break
          case 'video_edit.annotation':
            if (ids.some(id => !sequence!.annotations.some(mark => mark.id === id))) throw new Error('标注不属于目标序列。')
            sequence!.annotations = sequence!.annotations.filter(mark => !ids.includes(mark.id)); break
        }
        refs.push(...step.operation.targets)
      }
      return document
    })
    return completed(before, after, refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
