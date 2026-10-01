import { fieldEffectContract, fieldWriterTable, type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationEffectReceipt, type ApplicationEvidence, type ApplicationExecutionContext, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationRef, type JsonValue } from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control/execution/writerTable'
import { videoEditAnnotationSchema, videoEditClipSchema, videoEditDocumentSchema, videoEditBinSchema, videoEditItemSchema, videoEditTrackSchema, createVideoEditSequence, changeVideoEditSequenceSettings, type VideoEditDocument } from '@/core/videoEdit/document'
import { editVideoProject, restoreVideoEditSnapshot, requireVideoEditInstance, getVideoEditProjectView, setVideoEditProjectView, switchVideoEditSequence, getVideoEditTimelineView, setVideoEditTimelineView, validateVideoEditTimelineView, validateVideoEditProgramControl, setVideoEditView, videoEditProgramCommandIdentity, restoreVideoEditProgramCommandIdentity, videoEditDomainRevision as videoEditRevision, type VideoEditProjectView, type VideoEditTimelineView } from './videoEditService'
import { VIDEO_EDIT_FIELDS, videoEditDataKey, type VideoEditEntityType } from './videoEditFields'
import { readVideoEditData, splitVideoEditRef } from './videoEditReflection'
import { removeVideoEditItems, removeVideoEditBins, makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createVideoEditCodeItems, createVideoEditCodeVersions } from './videoEditCodeService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeDocument } from './videoEditCodeTrial'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'

interface ProjectViewSnapshot { view: VideoEditProjectView; activeSequenceId: string; timeline: VideoEditTimelineView; primary: string | null; program: { frame: number; playing: boolean; playbackDirection: 1 | -1 }; programCommand: object }
function projectViewSnapshot(projectId: string): ProjectViewSnapshot {
  const owner = requireVideoEditInstance(projectId)
  return { view: getVideoEditProjectView(projectId), activeSequenceId: owner.activeSequenceId, timeline: getVideoEditTimelineView(projectId), primary: owner.selection, program: { frame: owner.frame, playing: owner.playing, playbackDirection: owner.playbackDirection }, programCommand: videoEditProgramCommandIdentity(projectId) }
}
function sameProjectView(current: ProjectViewSnapshot, expected: ProjectViewSnapshot): boolean {
  const comparable = (value: ProjectViewSnapshot): unknown => ({ view: value.view, activeSequenceId: value.activeSequenceId, timeline: value.timeline, primary: value.primary })
  return current.programCommand === expected.programCommand && JSON.stringify(comparable(current)) === JSON.stringify(comparable(expected))
}
const undo = new Map<string, { owner: object; before: VideoEditDocument; after: VideoEditDocument; refs: ApplicationRef[]; viewBefore?: ProjectViewSnapshot; viewAfter?: ProjectViewSnapshot }>()
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
    const oldDefinitions = new Set(from.codeMaterials?.map(definition => definition.id))
    const definitions = (to.codeMaterials ?? []).filter(definition => !oldDefinitions.has(definition.id))
    const definitionIds = new Set(definitions.map(definition => definition.id))
    const oldItems = new Set(from.items.map(item => item.id))
    for (const [items, entityType] of [[definitions.flatMap(definition => definition.versions), 'video_edit.code_version'], [to.items.filter(item => item.code && definitionIds.has(item.code.definitionId) && !oldItems.has(item.id)), 'video_edit.item']] as const) {
      for (let offset = 0; offset < items.length; offset += 256) effects.push({ effect, entityType, propertyIds: [], refs: items.slice(offset, offset + 256).map(item => ({ kind: entityType, id: `${after.id}:${item.id}` })), origin: { kind: 'cascade', declarationId: `video_edit.code_${entityType.split('.').at(-1)}_${effect}` } })
    }
    const oldMedia = new Set(from.media.map(media => media.id))
    const media = to.media.filter(media => !oldMedia.has(media.id))
    for (let offset = 0; offset < media.length; offset += 256) effects.push({ effect, entityType: 'video_edit.media', propertyIds: [], refs: media.slice(offset, offset + 256).map(media => ({ kind: 'video_edit.media', id: `${after.id}:${media.id}` })), origin: { kind: 'cascade', declarationId: `video_edit.item_media_${effect}` } })
  }
  return effects
}
function content(document: VideoEditDocument): string { return JSON.stringify({ ...document, revision: 0 }) }
function completed(before: VideoEditDocument, after: VideoEditDocument, refs: ApplicationRef[], viewBefore?: ProjectViewSnapshot): ApplicationCompletedStepResult {
  const undoToken = crypto.randomUUID(); undo.set(undoToken, { owner: requireVideoEditInstance(before.id), before, after, refs, viewBefore, viewAfter: viewBefore ? projectViewSnapshot(before.id) : undefined })
  while (undo.size > 100) undo.delete(undo.keys().next().value!)
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: refs, undoToken, cascadeEffects: cascades(before, after), evidence: [{ kind: 'entity_state', fact: '剪辑工程已修改，可由同一工程历史撤销。', capturedAt: new Date().toISOString() }] }
}
async function restore(token: string): Promise<ApplicationCompletedStepResult> {
  const record = undo.get(token); if (!record) throw new Error('撤销记录已过期，请使用工程撤销。')
  const instance = requireVideoEditInstance(record.before.id)
  if (instance !== record.owner) throw new Error('原工程会话已关闭，请使用当前工程历史。')
  if (content(instance.document) !== content(record.after)) throw new Error('工程已有后续修改，请逐步撤销。')
  if (record.viewAfter && !sameProjectView(projectViewSnapshot(record.before.id), record.viewAfter)) throw new Error('项目浏览会话已有后续修改，请按当前状态操作。')
  restoreVideoEditSnapshot(record.before.id, record.after, record.before); undo.delete(token)
  if (record.viewBefore) {
    setVideoEditProjectView(record.before.id, record.viewBefore.view); switchVideoEditSequence(record.before.id, record.viewBefore.activeSequenceId)
    setVideoEditTimelineView(record.before.id, record.viewBefore.timeline, record.viewBefore.primary ?? undefined)
    const restoredCommand = setVideoEditView(record.before.id, record.viewBefore.program)
    restoreVideoEditProgramCommandIdentity(record.before.id, restoredCommand, record.viewBefore.programCommand)
  }
  return { status: 'completed', resultingRevisions: { video_edit: videoEditRevision() }, directRefs: record.refs, cascadeEffects: cascades(record.after, record.before), evidence: [{ kind: 'entity_state', fact: '已恢复修改前工程内容。', capturedAt: new Date().toISOString() }] }
}
export class VideoEditMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract
  readonly writableProperties
  readonly propertyOperations
  constructor(readonly entityType: VideoEditEntityType) { const table = fieldWriterTable(VIDEO_EDIT_FIELDS[entityType]); this.writableProperties = writableProperties(table); this.propertyOperations = propertyOperations(table); this.effectContract = fieldEffectContract(VIDEO_EDIT_FIELDS[entityType]) }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const { projectId, childId } = splitVideoEditRef(step.target)
    const owner = requireVideoEditInstance(projectId); const before = owner.document
    const keys = step.mutations.map(mutation => mutation.propertyId)
    const writesView = this.entityType === 'video_edit.project' && keys.some(key => ['video_edit.project.selected_item_ids', 'video_edit.project.selected_bin_id', 'video_edit.project.open_sequence_ids', 'video_edit.project.timeline_view', 'video_edit.project.program_playback'].includes(key))
    const viewBefore = writesView ? projectViewSnapshot(projectId) : undefined
    const data = readVideoEditData(step.target)
    await applyWriterTable(fieldWriterTable(VIDEO_EDIT_FIELDS[this.entityType]), data, step.mutations)
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== before || (viewBefore && !sameProjectView(projectViewSnapshot(projectId), viewBefore))) throw new Error('工程或浏览会话已有后续修改，请重读当前状态。')
    if (this.entityType === 'video_edit.clip' && step.mutations.some(mutation => mutation.propertyId === 'video_edit.clip.source_in_us')) data.sourceRemainder = { numerator: 0, denominator: 1 }
    if (this.entityType === 'video_edit.project') {
      // Validate view writes before any persistent rename; a failed transaction cannot leave half an edit.
      const instance = requireVideoEditInstance(projectId)
      const selectedItemIds = data.selectedItemIds as string[]; const selectedBinId = String(data.selectedBinId); const openSequenceIds = data.openSequenceIds as string[]
      if (selectedItemIds.some(id => !instance.document.items.some(item => item.id === id)) || (selectedBinId && !instance.document.bins.some(bin => bin.id === selectedBinId)) || !openSequenceIds.length || openSequenceIds.some(id => !instance.document.sequences.some(sequence => sequence.id === id))) throw new Error('项目选区、素材箱或序列标签引用无效。')
      if (keys.includes('video_edit.project.timeline_view')) {
        if (!openSequenceIds.includes(instance.activeSequenceId)) throw new Error('请先切换序列，再修改该序列时间线视图。')
        validateVideoEditTimelineView(projectId, data.timelineView as unknown as VideoEditTimelineView)
      }
      if (keys.includes('video_edit.project.program_playback')) {
        if (!openSequenceIds.includes(instance.activeSequenceId)) throw new Error('请先切换序列，再修改该序列节目播放。')
        validateVideoEditProgramControl(projectId, data.programPlayback as ProjectViewSnapshot['program'])
      }
    }
    const update = (document: VideoEditDocument): VideoEditDocument => {
      if (this.entityType === 'video_edit.project') return { ...document, name: String(data.name) }
      if (this.entityType === 'video_edit.bin') return { ...document, bins: document.bins.map(item => item.id === childId ? videoEditBinSchema.parse(data) : item) }
      if (this.entityType === 'video_edit.item') return { ...document, items: document.items.map(item => item.id === childId ? videoEditItemSchema.parse(data) : item) }
      if (this.entityType === 'video_edit.code_material') return { ...document, codeMaterials: document.codeMaterials?.map(definition => definition.id === childId ? { ...definition, name: String(data.name) } : definition) }
      return { ...document, sequences: document.sequences.map(sequence => {
        if (this.entityType === 'video_edit.sequence' && sequence.id === childId) {
          const next = changeVideoEditSequenceSettings(sequence, { width: Number(data.width), height: Number(data.height), frameRate: data.frameRate as typeof sequence.frameRate, pixelAspectRatio: data.pixelAspectRatio as typeof sequence.pixelAspectRatio, sampleRate: data.sampleRate as typeof sequence.sampleRate, channels: data.channels as typeof sequence.channels })
          return { ...next, name: String(data.name), binId: data.binId ? String(data.binId) : undefined }
        }
        if (this.entityType === 'video_edit.clip') return { ...sequence, clips: sequence.clips.map(clip => clip.id === childId ? videoEditClipSchema.parse(data) : clip) }
        if (this.entityType === 'video_edit.annotation') return { ...sequence, annotations: sequence.annotations.map(mark => mark.id === childId ? videoEditAnnotationSchema.parse(data) : mark) }
        if (this.entityType === 'video_edit.track') return { ...sequence, tracks: sequence.tracks.map(track => track.id === childId ? videoEditTrackSchema.parse(data) : track) }
        return sequence
      }) }
    }
    if (this.entityType === 'video_edit.clip' && step.mutations.some(mutation => ['video_edit.clip.code_version_id', 'video_edit.clip.code_parameters'].includes(mutation.propertyId))) {
      const next = videoEditDocumentSchema.parse(update(structuredClone(before)))
      const sequence = next.sequences.find(sequence => sequence.clips.some(clip => clip.id === childId))!
      const oldCode = before.sequences.flatMap(sequence => sequence.clips).find(clip => clip.id === childId)?.code
      const nextCode = sequence.clips.find(clip => clip.id === childId)?.code
      const imageValues = (values: typeof oldCode): unknown => Object.entries(values?.parameters ?? {}).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'image').sort(([left], [right]) => left.localeCompare(right))
      if (oldCode?.versionId !== nextCode?.versionId || JSON.stringify(imageValues(oldCode)) !== JSON.stringify(imageValues(nextCode))) {
        const owner = requireVideoEditInstance(projectId)
        const clip = sequence.clips.find(clip => clip.id === childId)!
        await trialVideoEditCodeDocument(owner, before, next, sequence.id, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame)), context?.signal)
      }
    }
    const after = editVideoProject(projectId, update)
    if (writesView) setVideoEditProjectView(projectId, { selectedItemIds: data.selectedItemIds as string[], selectedBinId: String(data.selectedBinId), openSequenceIds: data.openSequenceIds as string[] })
    if (this.entityType === 'video_edit.project' && keys.includes('video_edit.project.timeline_view')) setVideoEditTimelineView(projectId, data.timelineView as unknown as VideoEditTimelineView)
    if (this.entityType === 'video_edit.project' && keys.includes('video_edit.project.program_playback')) setVideoEditView(projectId, data.programPlayback as ProjectViewSnapshot['program'])
    return completed(before, after, [step.target], viewBefore)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'mutation' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
export class VideoEditCollectionExecutor implements ApplicationCollectionExecutor {
  readonly effectContract
  constructor(readonly entityType: 'video_edit.sequence' | 'video_edit.bin' | 'video_edit.item' | 'video_edit.clip' | 'video_edit.annotation' | 'video_edit.code_material' | 'video_edit.code_version') {
    this.effectContract = { direct: [], cascades: entityType === 'video_edit.sequence' ? (['create', 'delete'] as const).map(effect => ({ declarationId: `video_edit.sequence_tracks_${effect}`, effect, entityType: 'video_edit.track', propertyIds: [], revisionScopes: ['video_edit'] })) : entityType === 'video_edit.code_material' ? (['create', 'delete'] as const).flatMap(effect => (['video_edit.item', 'video_edit.code_version'] as const).map(type => ({ declarationId: `video_edit.code_${type.split('.').at(-1)}_${effect}`, effect, entityType: type, propertyIds: [], revisionScopes: ['video_edit'] }))) : entityType === 'video_edit.item' ? (['create', 'delete'] as const).map(effect => ({ declarationId: `video_edit.item_media_${effect}`, effect, entityType: 'video_edit.media', propertyIds: [], revisionScopes: ['video_edit'] })) : [] }
  }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, context?: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const nested = this.entityType === 'video_edit.clip' || this.entityType === 'video_edit.annotation'
    if (step.parent.kind !== (nested ? 'video_edit.sequence' : 'video_edit.project')) throw new Error(nested ? '请使用所属剪辑序列作为父实体。' : '请使用所属剪辑工程作为父实体。')
    const parsed = splitVideoEditRef(step.parent)
    const instance = requireVideoEditInstance(parsed.projectId); const before = instance.document
    const refs: ApplicationRef[] = []
    if (this.entityType === 'video_edit.code_version') {
      if (step.operation.kind !== 'create') throw new Error('源码版本不可删除或原位改写，请创建新候选。')
      const inputs = step.operation.items.map(item => {
        const values = item.properties
        if (Object.keys(values).some(key => !['video_edit.code_version.source', 'video_edit.code_version.definition_id'].includes(key)) || typeof values['video_edit.code_version.source'] !== 'string' || typeof values['video_edit.code_version.definition_id'] !== 'string') throw new Error('创建源码版本只接受作者源码和所属素材定义。')
        return { source: values['video_edit.code_version.source'], definitionId: values['video_edit.code_version.definition_id'] }
      })
      const ids = await createVideoEditCodeVersions(before.id, inputs, context?.signal)
      return completed(before, requireVideoEditInstance(before.id).document, ids.map(id => ({ kind: this.entityType, id: `${before.id}:${id}` })))
    }
    if (this.entityType === 'video_edit.code_material' && step.operation.kind === 'create') {
      const inputs = step.operation.items.map(item => {
        const values = item.properties
        if (Object.keys(values).some(key => !['video_edit.code_material.source', 'video_edit.code_material.name', 'video_edit.code_material.bin_id'].includes(key))) throw new Error('创建代码素材仅接受作者源码、名称与素材箱；版本和运行产物由检查服务维护。')
        if (typeof values['video_edit.code_material.source'] !== 'string') throw new Error('请提供作者源码。')
        const name = values['video_edit.code_material.name']; const binId = values['video_edit.code_material.bin_id']
        if (name !== undefined && typeof name !== 'string' || binId !== undefined && typeof binId !== 'string') throw new Error('名称和素材箱引用必须为字符串。')
        return { source: values['video_edit.code_material.source'], ...(name !== undefined ? { name } : {}), ...(binId ? { binId } : {}) }
      })
      const ids = await createVideoEditCodeItems(before.id, inputs, context?.signal)
      const after = requireVideoEditInstance(before.id).document
      for (const id of ids) refs.push({ kind: this.entityType, id: `${before.id}:${after.items.find(item => item.id === id)!.code!.definitionId}` })
      return completed(before, after, refs)
    }
    const update = (document: VideoEditDocument): VideoEditDocument => {
      const sequence = document.sequences.find(sequence => sequence.id === parsed.childId)
      if (nested && !sequence) throw new Error('目标序列不存在。')
      if (step.operation.kind === 'create') {
        for (const item of step.operation.items) {
          const allowed = new Set(VIDEO_EDIT_FIELDS[this.entityType].filter(field => !field.propertyId.endsWith('.code')).map(field => field.propertyId))
          if (Object.keys(item.properties).some(key => !allowed.has(key))) throw new Error('创建仅接受已公开的实体字段；代码实例由正式源码检查或已有项目项维护。')
          const values: Record<string, JsonValue> = Object.fromEntries(Object.entries(item.properties).map(([key, value]) => [videoEditDataKey(key.slice(this.entityType.length + 1)), value]))
          for (const key of ['binId', 'parentId', 'linkId', 'groupId']) if (values[key] === '') delete values[key]
          if (values.sourceComponent === 'all') delete values.sourceComponent
          const id = crypto.randomUUID()
          switch (this.entityType) {
            case 'video_edit.sequence': document.sequences.push({ ...createVideoEditSequence(), ...values, id } as ReturnType<typeof createVideoEditSequence>); break
            case 'video_edit.bin': document.bins.push(videoEditBinSchema.parse({ id, ...values })); break
            case 'video_edit.item': document.items.push(videoEditItemSchema.parse({ id, ...values })); break
            case 'video_edit.clip': {
              const component = values.sourceComponent
              if (component !== undefined && component !== 'video' && component !== 'audio') throw new Error('source_component 必须为 all、video 或 audio。')
              const clip = makeVideoEditItemClip(document, String(values.itemId), sequence!.id, { frame: Number(values.start ?? 0), ...(values.track !== undefined ? { track: Number(values.track) } : {}), ...(component ? { sourceComponent: component } : {}) }, readVideoEditCodeMetadata(instance, document))
              const parameters = values.codeParameters; const curves = values.codeCurves; const versionId = values.codeVersionId
              delete values.codeParameters; delete values.codeCurves; delete values.codeVersionId
              if (parameters !== undefined || curves !== undefined || versionId !== undefined) {
                if (!clip.code) throw new Error('此片段没有代码实例参数。')
                values.code = { ...clip.code, ...(parameters !== undefined ? { parameters } : {}), ...(curves !== undefined ? { curves } : {}), ...(versionId !== undefined ? { versionId } : {}) }
              }
              sequence!.clips.push(videoEditClipSchema.parse({ ...clip, ...values, id })); break
            }
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
          case 'video_edit.bin': document.bins = removeVideoEditBins(document, ids).bins; break
          case 'video_edit.item': { const next = removeVideoEditItems(document, ids); document.items = next.items; document.media = next.media; break }
          case 'video_edit.code_material':
            if (document.items.some(item => item.code && ids.includes(item.code.definitionId)) || document.sequences.some(sequence => sequence.clips.some(clip => clip.code && ids.includes(clip.code.definitionId)))) throw new Error('代码素材仍被项目项或片段引用，请先移除引用，再移除源码定义。')
            document.codeMaterials = document.codeMaterials?.filter(definition => !ids.includes(definition.id)); break
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
    }
    const next = videoEditDocumentSchema.parse(update(structuredClone(before)))
    if (this.entityType === 'video_edit.clip' && step.operation.kind === 'create') {
      const sequence = next.sequences.find(sequence => sequence.id === parsed.childId)!
      const added = new Set(refs.map(ref => splitVideoEditRef(ref).childId))
      for (const clip of sequence.clips) if (added.has(clip.id) && clip.code && (codeMaterialImageIds(clip.code).size > 0 || next.items.find(item => item.id === clip.itemId)?.code?.versionId !== clip.code.versionId)) {
        await trialVideoEditCodeDocument(instance, before, next, sequence.id, clip.start, context?.signal)
      }
    }
    const after = editVideoProject(before.id, () => next)
    return completed(before, after, refs)
  }
  async compensate(_step: Extract<ApplicationPlannedStep, { kind: 'collection' }>, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> { return result.undoToken ? (await restore(result.undoToken)).evidence : [] }
  async undo(token: string): Promise<ApplicationCompletedStepResult> { return restore(token) }
}
