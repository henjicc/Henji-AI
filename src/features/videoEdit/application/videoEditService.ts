import { createLogger } from '@/core/logging'
import { reconcileVideoEditTimedContent } from '@/core/videoEdit/timedContent'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { createVideoEditDocument, createVideoEditSequence, changeVideoEditSequenceSettings, videoEditComposition, videoEditDocumentSchema, videoEditClipSchema, type VideoEditClip, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence, type VideoEditMedia } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { rescaleVideoEditFrame } from '@/core/videoEdit/time'
import { assertVideoEditLockedTracks, assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { expandVideoEditSelection, type VideoEditTimelineTool } from '@/core/videoEdit/timelineSelection'
import { applyVideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { getPlatform } from '@/platform/runtime'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { installVideoEditCodeMetadata, prepareVideoEditCodeMetadata, readVideoEditCodeMetadata, releaseVideoEditCodeCompiler } from './videoEditCodeState'
import type { VideoEditCodeMetadata } from './videoEditCodeState'

const logger = createLogger('features.videoEdit')
export interface VideoEditTimelineView {
  selectedClipIds: string[]
  targetTrackIds: string[]
  tool: VideoEditTimelineTool
  snapping: boolean
  zoom: number
  inFrame: number | null
  outFrame: number | null
}
export interface VideoEditInstance extends VideoEditTimelineView {
  document: VideoEditDocument
  activeSequenceId: string
  sequenceViews: Map<string, VideoEditTimelineView & { selection: string | null; frame: number }>
  selectedItemIds: string[]
  selectedBinId: string
  openSequenceIds: string[]
  path: string
  dirty: boolean
  error: string | null
  past: VideoEditDocument[]
  future: VideoEditDocument[]
  selection: string | null
  frame: number
  playing: boolean
  playbackDirection: 1 | -1
  scrubbing?: boolean
  busy: boolean
  activePanel: 'project' | 'source' | 'program' | 'timeline' | 'effects' | 'content'
  panelFocusVersion?: number
  version: number
  saving?: Promise<void>
}
const instances = new Map<string, VideoEditInstance>()
const listeners = new Set<() => void>()
const domainListeners = new Set<() => void>()
const viewListeners = new Set<() => void>()
let viewRevision = 0
let revision = 0
let domainRevision = 0
let activeId: string | null = null
const autosaves = new Map<string, ReturnType<typeof setTimeout>>()
const retryDelays = new Map<string, number>()
export interface VideoEditGesture { readonly projectId: string; readonly token: string }
interface GestureState { handle: VideoEditGesture; before: VideoEditDocument; dirty: boolean; finished: Promise<void>; release: () => void }
const gestures = new WeakMap<VideoEditInstance, GestureState>()
const closing = new WeakMap<VideoEditInstance, Promise<void>>()
const programCommands = new WeakMap<VideoEditInstance, object>()
export function videoEditProgramCommandIdentity(id: string): object {
  const owner = requireVideoEditInstance(id); let command = programCommands.get(owner)
  if (!command) { command = {}; programCommands.set(owner, command) }
  return command
}
export function restoreVideoEditProgramCommandIdentity(id: string, expected: object, previous: object): void {
  if (videoEditProgramCommandIdentity(id) !== expected) throw new Error('节目播放已有后续操作。')
  programCommands.set(requireVideoEditInstance(id), previous)
}
function assertVideoEditWritable(owner: VideoEditInstance): void { if (closing.has(owner)) throw new Error('工程正在关闭，请等待保存完成。') }
export function videoEditGestureActive(projectId: string): boolean { return gestures.has(requireVideoEditInstance(projectId)) }
export function beginVideoEditGesture(projectId: string): VideoEditGesture {
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(projectId)
  assertVideoEditWritable(owner)
  if (gestures.has(owner)) throw new Error('请先完成当前参数调整。')
  const handle = Object.freeze({ projectId, token: crypto.randomUUID() })
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  gestures.set(owner, { handle, before: owner.document, dirty: owner.dirty, finished, release })
  return handle
}
function sameDocumentContent(left: VideoEditDocument, right: VideoEditDocument): boolean { return JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 }) }
export function updateVideoEditGesture(handle: VideoEditGesture, update: (document: VideoEditDocument) => VideoEditDocument): VideoEditDocument {
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(handle.projectId)
  assertVideoEditWritable(owner)
  if (gestures.get(owner)?.handle !== handle) throw new Error('原参数调整已结束，请重新编辑。')
  return applyVideoEditDocument(owner, update, false)
}
const picturePositionSchema = videoEditClipSchema.pick({ x: true, y: true }).strict()
/** Only these two bounded scalars change: timing, references, code and anchored content stay valid. */
export function updateVideoEditPicturePosition(handle: VideoEditGesture, sequenceId: string, clipId: string, position: Pick<VideoEditClip, 'x' | 'y'>): VideoEditDocument {
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(handle.projectId); assertVideoEditWritable(owner)
  if (gestures.get(owner)?.handle !== handle) throw new Error('原参数调整已结束，请重新编辑。')
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  const clip = sequence?.clips.find(clip => clip.id === clipId)
  if (!sequence || !clip || clip.kind === 'audio') throw new Error('目标画面片段不存在。')
  assertVideoEditClipsEditable(sequence, [clipId])
  const values = picturePositionSchema.parse(position)
  if (clip.x === values.x && clip.y === values.y) return owner.document
  const nextSequence = { ...sequence, clips: sequence.clips.map(value => value === clip ? { ...clip, ...values } : value) }
  return publishVideoEditDocument(owner, { ...owner.document, sequences: owner.document.sequences.map(value => value === sequence ? nextSequence : value) }, false)
}
export function finishVideoEditGesture(handle: VideoEditGesture, commit = true): void {
  const owner = instances.get(handle.projectId); const state = owner && gestures.get(owner)
  if (!owner || !state || state.handle !== handle) return
  if (commit) assertApplicationWritesAllowed()
  gestures.delete(owner)
  if (commit && !sameDocumentContent(owner.document, state.before)) {
    owner.past = [...owner.past.slice(-49), state.before]; owner.future = []
  } else {
    const before = owner.document
    owner.document = { ...state.before, revision: before.revision + 1 }; owner.version++; owner.dirty = state.dirty
    rescaleSequenceViews(owner, before); reconcileSequenceView(owner)
  }
  state.release(); publishVideoEdit(true)
  if (owner.dirty) scheduleVideoEditSave(handle.projectId)
}
function cancelVideoEditGesture(owner: VideoEditInstance): void { const state = gestures.get(owner); if (state) finishVideoEditGesture(state.handle, false) }
function scheduleVideoEditSave(id: string, delay = 0): void {
  const existing = autosaves.get(id)
  if (existing !== undefined) clearTimeout(existing)
  autosaves.set(id, setTimeout(() => {
    autosaves.delete(id)
    if (!instances.get(id)?.dirty) return
    void saveVideoEdit(id).then(() => retryDelays.delete(id)).catch(() => {
      if (!instances.get(id)?.dirty) return
      const retry = Math.min(30000, (retryDelays.get(id) ?? 1000) * 2)
      retryDelays.set(id, retry); scheduleVideoEditSave(id, retry)
    })
  }, delay))
}
export function subscribeVideoEdit(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditRevision(): number { return revision }
export function subscribeVideoEditView(listener: () => void): () => void { viewListeners.add(listener); return () => { viewListeners.delete(listener) } }
export function videoEditViewRevision(): number { return viewRevision }
function publishView(): void { viewRevision++; for (const listener of viewListeners) listener() }
export function videoEditDomainRevision(): number { return domainRevision }
export function subscribeVideoEditDomain(listener: () => void): () => void { domainListeners.add(listener); return () => { domainListeners.delete(listener) } }
export function listVideoEditInstances(): VideoEditInstance[] { return [...instances.values()] }
export function activeVideoEditInstance(): VideoEditInstance | undefined { return activeId ? instances.get(activeId) : undefined }
export function requireVideoEditInstance(id: string): VideoEditInstance { const instance = instances.get(id); if (!instance) throw new Error('请先从本地打开目标剪辑工程。'); return instance }
export function publishVideoEdit(changed = false): void { revision++; if (changed) { domainRevision++; for (const listener of domainListeners) listener() } for (const listener of listeners) listener(); publishView() }
export function focusVideoEdit(id: string): void { requireVideoEditInstance(id); if (activeId && activeId !== id) { const previous = instances.get(activeId); if (previous) cancelVideoEditGesture(previous) } activeId = id; publishVideoEdit() }
const compositions = new WeakMap<VideoEditDocument, Map<string, VideoEditComposition>>()
export function getActiveVideoEditSequence(instance: VideoEditInstance): VideoEditComposition {
  let cache = compositions.get(instance.document)
  if (!cache) { cache = new Map(); compositions.set(instance.document, cache) }
  let composition = cache.get(instance.activeSequenceId)
  if (!composition) { composition = videoEditComposition(instance.document, instance.activeSequenceId); cache.set(instance.activeSequenceId, composition) }
  return composition
}
function reconcileSequenceView(instance: VideoEditInstance): void {
  if (!instance.document.sequences.some(sequence => sequence.id === instance.activeSequenceId)) {
    instance.activeSequenceId = instance.document.sequences[0].id
    Object.assign(instance, instance.sequenceViews.get(instance.activeSequenceId) ?? defaultSequenceView(getActiveVideoEditSequence(instance)))
    instance.playing = false; instance.scrubbing = false
  }
  const sequence = getActiveVideoEditSequence(instance)
  instance.selectedClipIds = instance.selectedClipIds.filter(id => sequence.clips.some(clip => clip.id === id))
  if (!instance.selectedClipIds.includes(instance.selection ?? '')) instance.selection = instance.selectedClipIds[0] ?? null
  instance.targetTrackIds = instance.targetTrackIds.filter(id => sequence.tracks.some(track => track.id === id))
  instance.selectedItemIds = instance.selectedItemIds.filter(id => instance.document.items.some(item => item.id === id))
  if (instance.selectedBinId && !instance.document.bins.some(bin => bin.id === instance.selectedBinId)) instance.selectedBinId = ''
  instance.openSequenceIds = instance.openSequenceIds.filter(id => instance.document.sequences.some(sequence => sequence.id === id))
  if (!instance.openSequenceIds.includes(instance.activeSequenceId)) instance.openSequenceIds.push(instance.activeSequenceId)
}
function defaultSequenceView(sequence: VideoEditSequence): VideoEditTimelineView & { selection: string | null; frame: number } {
  return { selectedClipIds: [], targetTrackIds: ['video', 'audio'].flatMap(kind => { const track = sequence.tracks.find(track => track.kind === kind && !track.locked); return track ? [track.id] : [] }), tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null, selection: null, frame: 0 }
}
function rescaleSequenceViews(instance: VideoEditInstance, before: VideoEditDocument): void {
  for (const sequence of instance.document.sequences) {
    const previous = before.sequences.find(item => item.id === sequence.id)
    if (!previous || previous.frameRate.numerator * sequence.frameRate.denominator === sequence.frameRate.numerator * previous.frameRate.denominator) continue
    const view = instance.sequenceViews.get(sequence.id)
    const convert = (frame: number | null): number | null => frame === null ? null : rescaleVideoEditFrame(frame, previous.frameRate, sequence.frameRate)
    if (view) { view.frame = convert(view.frame)!; view.inFrame = convert(view.inFrame); view.outFrame = convert(view.outFrame) }
    if (instance.activeSequenceId === sequence.id) { instance.frame = convert(instance.frame)!; instance.inFrame = convert(instance.inFrame); instance.outFrame = convert(instance.outFrame); instance.playing = false }
  }
}
export function switchVideoEditSequence(projectId: string, sequenceId: string): void {
  const instance = requireVideoEditInstance(projectId)
  if (!instance.document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
  if (instance.activeSequenceId === sequenceId) return
  cancelVideoEditGesture(instance)
  instance.sequenceViews.set(instance.activeSequenceId, { ...getVideoEditTimelineView(projectId), selection: instance.selection, frame: instance.frame })
  instance.activeSequenceId = sequenceId
  if (!instance.openSequenceIds.includes(sequenceId)) instance.openSequenceIds.push(sequenceId)
  Object.assign(instance, structuredClone(instance.sequenceViews.get(sequenceId) ?? defaultSequenceView(getActiveVideoEditSequence(instance))))
  instance.playing = false; instance.playbackDirection = 1; instance.scrubbing = false; programCommands.set(instance, {}); reconcileSequenceView(instance); publishVideoEdit(true)
}
export function editVideoSequence(projectId: string, sequenceId: string, update: (sequence: VideoEditSequence) => VideoEditSequence): VideoEditDocument {
  return editVideoProject(projectId, document => {
    if (!document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
    return { ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? update(sequence) : sequence) }
  })
}
export function appendVideoEditSequence(projectId: string, settings: Partial<Omit<VideoEditSequence, 'id' | 'clips' | 'annotations' | 'tracks'>> = {}): string {
  const sequence = { ...createVideoEditSequence(`序列 ${requireVideoEditInstance(projectId).document.sequences.length + 1}`), ...settings }
  editVideoProject(projectId, document => ({ ...document, sequences: [...document.sequences, sequence] }))
  return sequence.id
}
export function duplicateVideoEditSequence(projectId: string, sequenceId: string): string {
  const source = requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === sequenceId)
  if (!source) throw new Error('目标序列不存在。')
  const sequence = structuredClone(source); sequence.id = crypto.randomUUID(); sequence.name = `${source.name} 副本`
  const clips = new Map(source.clips.map(clip => [clip.id, crypto.randomUUID()]))
  const links = new Map(source.clips.filter(clip => clip.linkId).map(clip => [clip.linkId!, crypto.randomUUID()]))
  const groups = new Map(source.clips.filter(clip => clip.groupId).map(clip => [clip.groupId!, crypto.randomUUID()]))
  sequence.tracks = sequence.tracks.map(track => ({ ...track, id: crypto.randomUUID() }))
  sequence.clips = sequence.clips.map(clip => ({ ...clip, id: clips.get(clip.id)!, ...(clip.linkId ? { linkId: links.get(clip.linkId) } : {}), ...(clip.groupId ? { groupId: groups.get(clip.groupId) } : {}) }))
  sequence.annotations = sequence.annotations.map(mark => ({ ...mark, id: crypto.randomUUID(), clipId: clips.get(mark.clipId)! }))
  if (sequence.markers) sequence.markers = sequence.markers.map(mark => ({ ...mark, id: crypto.randomUUID(), ...(mark.clipId ? { clipId: clips.get(mark.clipId)! } : {}) }))
  if (sequence.captions) sequence.captions = sequence.captions.map(caption => ({ ...caption, id: crypto.randomUUID(), ...(caption.clipId ? { clipId: clips.get(caption.clipId)! } : {}) }))
  editVideoProject(projectId, document => ({ ...document, sequences: [...document.sequences, sequence] })); return sequence.id
}
export function deleteVideoEditSequence(projectId: string, sequenceId: string): void {
  editVideoProject(projectId, document => { if (document.sequences.length === 1) throw new Error('工程至少保留一个序列。'); const sequence = document.sequences.find(sequence => sequence.id === sequenceId); if (!sequence) throw new Error('目标序列不存在。'); if (sequence.clips.length || sequence.annotations.length || sequence.markers?.length || sequence.captions?.length) throw new Error('请先移除序列内的片段和标注，再移除序列。'); return { ...document, sequences: document.sequences.filter(sequence => sequence.id !== sequenceId) } })
}
export function updateVideoEditSequenceSettings(projectId: string, sequenceId: string, settings: Parameters<typeof changeVideoEditSequenceSettings>[1] & { name?: string; binId?: string | null }): void {
  const { name, binId, ...timing } = settings
  editVideoSequence(projectId, sequenceId, sequence => ({ ...changeVideoEditSequenceSettings(sequence, timing), ...(name !== undefined ? { name } : {}), ...(binId !== undefined ? { binId: binId || undefined } : {}) }))
}
export function editVideoProject(id: string, update: (document: VideoEditDocument) => VideoEditDocument): VideoEditDocument {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id)
  assertVideoEditWritable(instance)
  if (gestures.has(instance)) throw new Error('请先完成当前参数调整。')
  return applyVideoEditDocument(instance, update, true)
}
/** Used only by verified transaction receipts; a rollback restores the whole edit, including locks. */
export function restoreVideoEditSnapshot(id: string, expected: VideoEditDocument, snapshot: VideoEditDocument): VideoEditDocument {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id); assertVideoEditWritable(instance)
  if (gestures.has(instance) || !sameDocumentContent(instance.document, expected)) throw new Error('工程已有后续修改，请逐步撤销。')
  return applyVideoEditDocument(instance, () => snapshot, true, true)
}
function applyVideoEditDocument(instance: VideoEditInstance, update: (document: VideoEditDocument) => VideoEditDocument, recordHistory: boolean, restoring = false): VideoEditDocument {
  const requested = update(structuredClone(instance.document))
  const next = videoEditDocumentSchema.parse(restoring ? requested : reconcileVideoEditTimedContent(instance.document, requested))
  if (!restoring) assertVideoEditLockedTracks(instance.document, next)
  validateCodeMaterialDocument(next, readVideoEditCodeMetadata(instance, next))
  if (JSON.stringify(next) === JSON.stringify(instance.document)) return instance.document
  return publishVideoEditDocument(instance, next, recordHistory)
}
function publishVideoEditDocument(instance: VideoEditInstance, next: VideoEditDocument, recordHistory: boolean): VideoEditDocument {
  if (recordHistory) { instance.past = [...instance.past.slice(-49), instance.document]; instance.future = [] }
  const before = instance.document
  instance.document = { ...next, revision: instance.document.revision + 1 }
  rescaleSequenceViews(instance, before)
  reconcileSequenceView(instance)
  instance.dirty = true; instance.error = null; instance.version++; publishVideoEdit(true)
  if (recordHistory) scheduleVideoEditSave(instance.document.id)
  return instance.document
}
export function undoVideoEdit(id: string, redo = false): void {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id)
  assertVideoEditWritable(instance)
  if (gestures.has(instance)) { cancelVideoEditGesture(instance); return }
  const target = redo ? instance.future.shift() : instance.past.pop()
  if (!target) return
  if (redo) instance.past.push(instance.document); else instance.future.unshift(instance.document)
  const before = instance.document
  instance.document = { ...target, revision: instance.document.revision + 1 }; instance.version++; instance.dirty = true
  rescaleSequenceViews(instance, before)
  reconcileSequenceView(instance)
  publishVideoEdit(true)
  scheduleVideoEditSave(id)
}
type VideoEditProgramControl = Partial<Pick<VideoEditInstance, 'frame' | 'playing' | 'playbackDirection'>>
export function validateVideoEditProgramControl(id: string, values: VideoEditProgramControl): void {
  const instance = requireVideoEditInstance(id)
  if (values.frame !== undefined && (!Number.isSafeInteger(values.frame) || values.frame < 0)) throw new Error('播放位置必须为非负整数帧。')
  if (values.frame !== undefined && values.frame > Math.floor(getActiveVideoEditSequence(instance).fps * 1800)) throw new Error('播放位置超出序列范围。')
  if (values.playbackDirection !== undefined && values.playbackDirection !== 1 && values.playbackDirection !== -1) throw new Error('播放方向无效。')
  if (values.playing !== undefined && typeof values.playing !== 'boolean') throw new Error('播放状态无效。')
}
export function setVideoEditView(id: string, values: Partial<Pick<VideoEditInstance, 'selection' | 'frame' | 'playing' | 'scrubbing' | 'playbackDirection'>>, observation = false): object {
  const instance = requireVideoEditInstance(id)
  validateVideoEditProgramControl(id, values)
  if (Object.entries(values).every(([key, value]) => instance[key as keyof VideoEditInstance] === value)) return videoEditProgramCommandIdentity(id)
  const selectionChanged = values.selection !== undefined && values.selection !== instance.selection
  const selectedClipIds = values.selection !== undefined ? values.selection ? expandVideoEditSelection(getActiveVideoEditSequence(instance), [values.selection]) : [] : instance.selectedClipIds
  const programCommand = !observation && ['frame', 'playing', 'playbackDirection'].some(key => Object.prototype.hasOwnProperty.call(values, key))
  if (programCommand) programCommands.set(instance, {})
  const command = videoEditProgramCommandIdentity(id)
  if (selectionChanged) cancelVideoEditGesture(instance)
  Object.assign(instance, values)
  instance.selectedClipIds = selectedClipIds
  if (selectionChanged) publishVideoEdit(programCommand)
  else { if (programCommand) domainRevision++; publishView() }
  return command
}
export function getVideoEditTimelineView(id: string): VideoEditTimelineView {
  const instance = requireVideoEditInstance(id)
  return { selectedClipIds: [...instance.selectedClipIds], targetTrackIds: [...instance.targetTrackIds], tool: instance.tool, snapping: instance.snapping, zoom: instance.zoom, inFrame: instance.inFrame, outFrame: instance.outFrame }
}
export function validateVideoEditTimelineView(id: string, values: Partial<VideoEditTimelineView>): VideoEditTimelineView {
  const instance = requireVideoEditInstance(id); const sequence = getActiveVideoEditSequence(instance)
  const next = { ...getVideoEditTimelineView(id), ...values }
  next.selectedClipIds = expandVideoEditSelection(sequence, next.selectedClipIds)
  next.targetTrackIds = [...new Set(next.targetTrackIds)]
  if (next.targetTrackIds.some(id => !sequence.tracks.some(track => track.id === id))) throw new Error('目标轨道不属于此序列。')
  if (!['select', 'razor', 'hand', 'track'].includes(next.tool) || typeof next.snapping !== 'boolean' || !Number.isFinite(next.zoom) || next.zoom < .1 || next.zoom > 20) throw new Error('时间线工具、吸附或缩放无效。')
  for (const frame of [next.inFrame, next.outFrame]) if (frame !== null && (!Number.isSafeInteger(frame) || frame < 0 || frame > Math.floor(sequence.fps * 1800))) throw new Error('序列入出点超出范围。')
  if (next.inFrame !== null && next.outFrame !== null && next.outFrame <= next.inFrame) throw new Error('出点必须晚于入点。')
  return next
}
export function setVideoEditTimelineView(id: string, values: Partial<VideoEditTimelineView>, primaryClipId?: string): void {
  const instance = requireVideoEditInstance(id); const next = validateVideoEditTimelineView(id, values)
  if (primaryClipId !== undefined && !next.selectedClipIds.includes(primaryClipId)) throw new Error('主片段必须属于当前选区。')
  const primary = primaryClipId ?? (next.selectedClipIds.includes(instance.selection ?? '') ? instance.selection : next.selectedClipIds[0] ?? null)
  if (JSON.stringify(next) === JSON.stringify(getVideoEditTimelineView(id)) && primary === instance.selection) return
  if (JSON.stringify(next.selectedClipIds) !== JSON.stringify(instance.selectedClipIds) || primary !== instance.selection) cancelVideoEditGesture(instance)
  Object.assign(instance, next)
  instance.selection = primary
  publishVideoEdit(true)
}
export function focusVideoEditPanel(id: string, panel: VideoEditInstance['activePanel']): void {
  const instance = requireVideoEditInstance(id)
  if (!['project', 'source', 'program', 'timeline', 'effects', 'content'].includes(panel)) throw new Error('剪辑面板不存在。')
  instance.activePanel = panel; instance.panelFocusVersion = (instance.panelFocusVersion ?? 0) + 1; publishView()
}
export type VideoEditProjectView = Pick<VideoEditInstance, 'selectedItemIds' | 'selectedBinId' | 'openSequenceIds'>
export function getVideoEditProjectView(id: string): VideoEditProjectView {
  const instance = requireVideoEditInstance(id)
  return { selectedItemIds: [...instance.selectedItemIds], selectedBinId: instance.selectedBinId, openSequenceIds: [...instance.openSequenceIds] }
}
export function setVideoEditProjectView(id: string, values: Partial<VideoEditProjectView>): void {
  const instance = requireVideoEditInstance(id)
  const next = { ...getVideoEditProjectView(id), ...values }
  if (next.selectedItemIds.some(itemId => !instance.document.items.some(item => item.id === itemId)) || next.selectedItemIds.length > 500) throw new Error('项目选区包含无效项目项。')
  if (next.selectedBinId && !instance.document.bins.some(bin => bin.id === next.selectedBinId)) throw new Error('目标素材箱不存在。')
  if (!next.openSequenceIds.length || next.openSequenceIds.some(sequenceId => !instance.document.sequences.some(sequence => sequence.id === sequenceId))) throw new Error('请至少保留一个有效的序列标签。')
  next.selectedItemIds = [...new Set(next.selectedItemIds)]; next.openSequenceIds = [...new Set(next.openSequenceIds)]
  if (JSON.stringify(next) === JSON.stringify(getVideoEditProjectView(id))) return
  Object.assign(instance, next)
  if (!next.openSequenceIds.includes(instance.activeSequenceId)) switchVideoEditSequence(id, next.openSequenceIds.at(-1)!)
  publishVideoEdit(true)
}
export async function saveVideoEdit(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  if (instance.saving) return instance.saving
  logger.info('保存剪辑工程', { event: 'video_edit.save.start', context: { projectId: id } })
  const saving = (async () => {
    while (instance.dirty) {
      const gesture = gestures.get(instance)
      if (gesture) { await gesture.finished; continue }
      const version = instance.version
      await getPlatform().system.fs.writeTextFile(instance.path, JSON.stringify(instance.document))
      instance.dirty = version !== instance.version
    }
    instance.error = null
    logger.info('剪辑工程已保存', { event: 'video_edit.save.completed', context: { projectId: id } })
  })()
  instance.saving = saving
  try { await saving } catch (error) {
    instance.error = error instanceof Error ? error.message : '保存失败，修改仍保留在当前工程。'
    logger.error('剪辑工程保存失败', error, { event: 'video_edit.save.failed', context: { projectId: id } }); throw error
  } finally { instance.saving = undefined; publishVideoEdit() }
}
function attach(document: VideoEditDocument, path: string, dirty: boolean, codeMetadata: VideoEditCodeMetadata = new Map()): VideoEditInstance {
  const existing = instances.get(document.id)
  if (existing) { if (existing.path !== path) throw new Error('此工程已从另一位置打开，请先关闭后再打开副本。'); focusVideoEdit(document.id); return existing }
  const instance: VideoEditInstance = { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id], path, dirty, error: null, past: [], future: [], ...defaultSequenceView(document.sequences[0]), playing: false, playbackDirection: 1, activePanel: 'timeline', busy: false, version: 0 }
  installVideoEditCodeMetadata(instance, codeMetadata)
  instances.set(document.id, instance); activeId = document.id; publishVideoEdit(true); return instance
}
export async function createVideoEditProject(): Promise<VideoEditInstance | null> {
  const path = await getPlatform().system.dialog.save({ defaultPath: '未命名剪辑.henji-video', filters: [{ name: '痕迹剪辑工程', extensions: ['henji-video'] }] })
  if (!path) return null
  const name = path.split(/[\\/]/).at(-1)?.replace(/\.henji-video$/i, '') || '未命名剪辑'
  const instance = attach(createVideoEditDocument(name), path, true)
  await saveVideoEdit(instance.document.id); return instance
}
export async function openVideoEditProject(path?: string): Promise<VideoEditInstance | null> {
  const chosen = path ?? await getPlatform().system.dialog.open({ filters: [{ name: '痕迹剪辑工程', extensions: ['henji-video'] }] })
  if (!chosen || Array.isArray(chosen)) return null
  const existing = listVideoEditInstances().find(instance => instance.path === chosen)
  if (existing) { focusVideoEdit(existing.document.id); return existing }
  const raw: unknown = JSON.parse(await getPlatform().system.fs.readTextFile(chosen))
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version !== 2) throw new Error('此工程使用不支持的旧格式。请保留原文件并新建工程。')
  const document = videoEditDocumentSchema.parse(raw)
  try {
    const codeMetadata = await prepareVideoEditCodeMetadata(document)
    for (const media of document.media) await getPlatform().media.allowRoot(await getPlatform().system.paths.dirname(media.path))
    return attach(document, chosen, false, codeMetadata)
  } catch (error) {
    if (!instances.size) releaseVideoEditCodeCompiler()
    throw error
  }
}
export async function closeVideoEditProject(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  const previous = closing.get(instance)
  if (previous) return previous
  if (instance.busy) throw new Error('请等待导出完成或取消导出。')
  const operation = Promise.resolve().then(async () => {
    cancelVideoEditGesture(instance); instance.playing = false
    await saveVideoEdit(id)
    const timer = autosaves.get(id); if (timer !== undefined) clearTimeout(timer)
    autosaves.delete(id); retryDelays.delete(id)
    instances.delete(id); if (activeId === id) activeId = instances.keys().next().value ?? null; publishVideoEdit(true)
    if (!instances.size) releaseVideoEditCodeCompiler()
  }).finally(() => { closing.delete(instance) })
  closing.set(instance, operation)
  return operation
}
export function appendVideoEditMedia(id: string, media: VideoEditMedia): void {
  editVideoProject(id, document => ({ ...document, media: [...document.media, media], items: [...document.items, { id: crypto.randomUUID(), name: media.name, kind: media.kind, mediaId: media.id }] }))
}
export function appendVideoEditClip(id: string, mediaId?: string, placement?: { frame: number; track: number }, sequenceId?: string): void {
  const instance = requireVideoEditInstance(id)
  const targetSequenceId = sequenceId ?? instance.activeSequenceId
  const media = instance.document.media.find(item => item.id === mediaId)
  if (mediaId && !media) throw new Error('素材不存在。')
  const existingItem = media ? instance.document.items.find(item => item.mediaId === media.id) : undefined
  const item = existingItem ?? { id: crypto.randomUUID(), name: media?.name ?? '文字', kind: media?.kind ?? 'text' as const, ...(media ? { mediaId: media.id } : {}) }
  const candidate = { ...instance.document, items: existingItem ? instance.document.items : [...instance.document.items, item] }
  const clip = makeVideoEditItemClip(candidate, item.id, targetSequenceId, placement ?? { frame: instance.activeSequenceId === targetSequenceId ? instance.frame : instance.sequenceViews.get(targetSequenceId)?.frame ?? 0 }, readVideoEditCodeMetadata(instance, candidate))
  editVideoProject(id, document => ({ ...document, items: existingItem ? document.items : [...document.items, item], sequences: document.sequences.map(sequence => sequence.id === targetSequenceId ? { ...sequence, clips: [...sequence.clips, clip] } : sequence) }))
  if (instance.activeSequenceId === targetSequenceId) setVideoEditView(id, { selection: clip.id })
}
export function splitSelectedVideoEdit(id: string): void { const instance = requireVideoEditInstance(id); if (instance.selectedClipIds.length) editVideoSequence(id, instance.activeSequenceId, () => applyVideoEditTimelineEdit(instance.document, instance.activeSequenceId, { kind: 'split', clipIds: instance.selectedClipIds, frame: instance.frame })) }
export function deleteVideoEditClip(id: string, clipId: string): void {
  const instance = requireVideoEditInstance(id)
  const sequence = instance.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
  if (!sequence) throw new Error('片段不存在。')
  editVideoSequence(id, sequence.id, () => applyVideoEditTimelineEdit(instance.document, sequence.id, { kind: 'delete', clipIds: [clipId] }))
  if (requireVideoEditInstance(id).selection === clipId) setVideoEditView(id, { selection: null })
}
registerApplicationCloseGuard(async () => {
  for (const instance of instances.values()) { if (instance.busy) throw new Error('剪辑工程正在导出，请等待或取消。'); cancelVideoEditGesture(instance); instance.playing = false; await saveVideoEdit(instance.document.id) }
})
