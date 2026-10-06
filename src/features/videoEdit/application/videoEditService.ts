import { copyVideoEditSequence } from '@/core/videoEdit/sequenceCopy'
import { createLogger } from '@/core/logging'
import { reconcileVideoEditTimedContent } from '@/core/videoEdit/timedContent'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { createVideoEditSequence, changeVideoEditSequenceSettings, videoEditComposition, videoEditDuration, videoEditDocumentSchema, videoEditClipSchema, type VideoEditClip, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence, type VideoEditMedia } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { rescaleVideoEditFrame } from '@/core/videoEdit/time'
import { assertVideoEditLockedTracks, assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { expandVideoEditSelection, videoEditPickRelations, VIDEO_EDIT_TIMELINE_TOOLS, type VideoEditTimelineTool } from '@/core/videoEdit/timelineSelection'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import type { DocumentTarget, ProjectSummary } from '@/core/documents/types'
import type { VideoEditDocumentContent } from '@/core/documents/kinds/videoEdit'
import { isDocumentServiceError, toError } from '@/features/documents/documentErrors'
import type { DocumentSession } from '@/features/documents/documentSession'
import { getDocumentSessionRegistry, parentFolderOf, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import type { DocumentContentAdapter, DocumentLeaveOutcome } from '@/features/documents/documentSessionTypes'
import { getDocumentOperations, type DocumentOperations } from '@/features/documents/documentOperations'
import { ensureVideoEditCodeDocumentMetadata, installVideoEditCodeMetadata, prepareVideoEditCodeMetadata, readVideoEditCodeMetadata, releaseVideoEditCodeCompiler } from './videoEditCodeState'
import { validateVideoEditGraphicTextBudget } from './videoEditGraphicTextBudget'
import { videoEditClipUnderPlayhead } from './videoEditPlayheadSelection'
import { useSettingsStore } from '@/stores/settingsStore'
import { updateVideoEditProjectCover } from './videoEditProjectCover'
import { videoEditInPlaceRecordsSchema, type VideoEditInPlaceRecord } from '@/core/videoEdit/inPlacePersistence'

const logger = createLogger('features.videoEdit')
export interface VideoEditTimelineView {
  selectedClipIds: string[]
  targetTrackIds: string[]
  tool: VideoEditTimelineTool
  snapping: boolean
  zoom: number
  inFrame: number | null
  outFrame: number | null
  /** Premiere Linked Selection (absent means on): clicks extend to linked partners; groups always. The selection itself is the edit set. */
  linkedSelection?: boolean
}
export interface VideoEditInstance extends VideoEditTimelineView {
  document: VideoEditDocument
  activeSequenceId: string
  sequenceViews: Map<string, VideoEditTimelineView & { selection: string | null; frame: number }>
  selectedItemIds: string[]
  selectedBinId: string
  openSequenceIds: string[]
  /** 剪辑文档会话（存储底座 2.4）：自动保存、草稿、离开与冲突都由它负责。 */
  session: DocumentSession
  /** 有尚未写入剪辑文件的修改（来自会话保存状态；只读）。 */
  readonly dirty: boolean
  /** 自动保存失败时给用户的说明（来自会话保存状态；只读）。 */
  readonly error: string | null
  past: VideoEditDocument[]
  future: VideoEditDocument[]
  selection: string | null
  frame: number
  playing: boolean
  playbackDirection: 1 | -1
  scrubbing?: boolean
  busy: boolean
  activePanel: 'project' | 'source' | 'program' | 'timeline' | 'effects' | 'content' | 'tracking' | 'lumetri'
  panelFocusVersion?: number
  version: number
}
const instances = new Map<string, VideoEditInstance>()
const activities = new WeakMap<VideoEditInstance, Set<string>>()
/** Long-running local preparation/ASR keeps its original document alive without blocking timeline edits. */
export function holdVideoEditActivity(id: string, label: string): () => void {
  const owner = requireVideoEditInstance(id); assertVideoEditWritable(owner)
  const values = activities.get(owner) ?? new Set<string>(); const token = `${label}:${crypto.randomUUID()}`
  values.add(token); activities.set(owner, values)
  return () => { values.delete(token) }
}
const listeners = new Set<() => void>()
const domainListeners = new Set<() => void>()
const viewListeners = new Set<() => void>()
let viewRevision = 0
let revision = 0
let domainRevision = 0
let activeId: string | null = null
/** 内容变化（进撤销的修改、撤销 / 重做、参数调整提交）时通知会话标脏并防抖保存。 */
const contentListeners = new WeakMap<VideoEditInstance, Set<() => void>>()
const disposers = new WeakMap<VideoEditInstance, () => void>()
const leaving = new Map<string, Promise<DocumentLeaveOutcome>>()
let registryOverride: DocumentSessionRegistry | null = null
let operationsOverride: DocumentOperations | null = null

/** 仅供测试：换成内存替身的会话登记表与通用文档操作；传 null 恢复应用唯一的那一个。 */
export function setVideoEditDocumentServicesForTests(services: { registry: DocumentSessionRegistry; operations: DocumentOperations } | null): void {
  registryOverride = services?.registry ?? null
  operationsOverride = services?.operations ?? null
}
function documentRegistry(): DocumentSessionRegistry { return registryOverride ?? getDocumentSessionRegistry() }
function documentOperations(): DocumentOperations { return operationsOverride ?? getDocumentOperations() }
/** 剪辑用的通用文档操作（测试时是替身）：在剪辑里组合文档（4.1）也走它。 */
export function videoEditDocumentOperations(): DocumentOperations { return documentOperations() }
export interface VideoEditGesture { readonly projectId: string; readonly token: string }
interface GestureState { handle: VideoEditGesture; before: VideoEditDocument; finished: Promise<void>; release: () => void }
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
function assertVideoEditWritable(owner: VideoEditInstance): void { if (closing.has(owner)) throw new Error('剪辑正在关闭，请等待保存完成。') }
export function videoEditGestureActive(projectId: string): boolean { return gestures.has(requireVideoEditInstance(projectId)) }
export function beginVideoEditGesture(projectId: string): VideoEditGesture {
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(projectId)
  assertVideoEditWritable(owner)
  if (gestures.has(owner)) throw new Error('请先完成当前参数调整。')
  const handle = Object.freeze({ projectId, token: crypto.randomUUID() })
  let release!: () => void
  const finished = new Promise<void>(resolve => { release = resolve })
  gestures.set(owner, { handle, before: owner.document, finished, release })
  return handle
}
function sameDocumentContent(left: VideoEditDocument, right: VideoEditDocument): boolean { return JSON.stringify({ ...left, revision: 0, inPlaceGenerations: undefined }) === JSON.stringify({ ...right, revision: 0, inPlaceGenerations: undefined }) }
function withInPlaceMetadata(document: VideoEditDocument, current: VideoEditDocument): VideoEditDocument {
  const next = { ...document }
  if (current.inPlaceGenerations?.length) next.inPlaceGenerations = current.inPlaceGenerations
  else delete next.inPlaceGenerations
  return next
}
/** 任务元数据沿用会话保存屏障，不增加撤销步、不清空重做，也不推进剪辑内容版本。 */
export function updateVideoEditInPlaceMetadata(id: string, records: readonly VideoEditInPlaceRecord[]): void {
  assertApplicationWritesAllowed()
  const owner = requireVideoEditInstance(id)
  // 关闭已冻结会话内容；保留此前已保存的续接点，关闭完成后由新会话续查。
  if (closing.has(owner) || owner.session.isEnded) return
  const parsed = videoEditInPlaceRecordsSchema.parse(records)
  if (JSON.stringify(owner.document.inPlaceGenerations ?? []) === JSON.stringify(parsed)) return
  owner.document = { ...owner.document }
  if (parsed.length) owner.document.inPlaceGenerations = parsed
  else delete owner.document.inPlaceGenerations
  owner.version++; notifyVideoEditContent(owner); publishVideoEdit()
}
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
  if (clip.kind === 'adjustment') throw new Error('调整图层请修改作用范围和效果，不能移动画面位置。')
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
  const committed = commit && !sameDocumentContent(owner.document, state.before)
  if (committed) {
    owner.past = [...owner.past.slice(-49), state.before]; owner.future = []
  } else {
    const before = owner.document
    owner.document = withInPlaceMetadata({ ...state.before, name: before.name, revision: before.revision + 1 }, before); owner.version++
    rescaleSequenceViews(owner, before); reconcileSequenceView(owner)
  }
  state.release(); publishVideoEdit(true)
  if (committed) notifyVideoEditContent(owner)
}
function cancelVideoEditGesture(owner: VideoEditInstance): void { const state = gestures.get(owner); if (state) finishVideoEditGesture(state.handle, false) }
function notifyVideoEditContent(instance: VideoEditInstance): void {
  for (const listener of contentListeners.get(instance) ?? []) listener()
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
export function requireVideoEditInstance(id: string): VideoEditInstance { const instance = instances.get(id); if (!instance) throw new Error('请先打开目标剪辑：在剪辑页打开所在项目，或用 open_document 打开这份剪辑（文档 ID 取自 list_documents）。'); return instance }
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
  return { selectedClipIds: [], targetTrackIds: ['video', 'audio'].flatMap(kind => { const track = sequence.tracks.find(track => track.kind === kind && !track.locked); return track ? [track.id] : [] }), tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null, linkedSelection: true, selection: null, frame: 0 }
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
  const sequence = copyVideoEditSequence(source)
  editVideoProject(projectId, document => ({ ...document, sequences: [...document.sequences, sequence] })); return sequence.id
}
export function deleteVideoEditSequence(projectId: string, sequenceId: string): void {
  editVideoProject(projectId, document => { if (document.sequences.length === 1) throw new Error('剪辑至少保留一个序列。'); const sequence = document.sequences.find(sequence => sequence.id === sequenceId); if (!sequence) throw new Error('目标序列不存在。'); if (sequence.clips.length || sequence.annotations.length || sequence.markers?.length || sequence.captions?.length || sequence.transitions?.length) throw new Error('请先移除序列内的片段和标注，再移除序列。'); return { ...document, sequences: document.sequences.filter(sequence => sequence.id !== sequenceId) } })
}
export function updateVideoEditSequenceSettings(projectId: string, sequenceId: string, settings: Parameters<typeof changeVideoEditSequenceSettings>[1] & { name?: string; binId?: string | null }): void {
  const { name, binId, ...timing } = settings
  editVideoSequence(projectId, sequenceId, sequence => ({ ...changeVideoEditSequenceSettings(sequence, timing), ...(name !== undefined ? { name } : {}), ...(binId !== undefined ? { binId: binId || undefined } : {}) }))
}
export function editVideoProject(id: string, update: (document: VideoEditDocument) => VideoEditDocument, preserveProgramAnchors: readonly string[] = []): VideoEditDocument {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id)
  assertVideoEditWritable(instance)
  if (gestures.has(instance)) throw new Error('请先完成当前参数调整。')
  return applyVideoEditDocument(instance, update, true, false, preserveProgramAnchors)
}
/** Used only by verified transaction receipts; a rollback restores the whole edit, including locks. */
export function restoreVideoEditSnapshot(id: string, expected: VideoEditDocument, snapshot: VideoEditDocument): VideoEditDocument {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id); assertVideoEditWritable(instance)
  if (gestures.has(instance) || !sameDocumentContent(instance.document, expected)) throw new Error('剪辑已有后续修改，请逐步撤销。')
  return applyVideoEditDocument(instance, () => withInPlaceMetadata(snapshot, instance.document), true, true)
}
function applyVideoEditDocument(instance: VideoEditInstance, update: (document: VideoEditDocument) => VideoEditDocument, recordHistory: boolean, restoring = false, preserveProgramAnchors: readonly string[] = []): VideoEditDocument {
  const requested = update(structuredClone(instance.document))
  const next = videoEditDocumentSchema.parse(restoring ? requested : reconcileVideoEditTimedContent(instance.document, requested, preserveProgramAnchors))
  if (!restoring) assertVideoEditLockedTracks(instance.document, next)
  validateCodeMaterialDocument(next, readVideoEditCodeMetadata(instance, next))
  if (JSON.stringify(next) === JSON.stringify(instance.document)) return instance.document
  return publishVideoEditDocument(instance, next, recordHistory)
}
function publishVideoEditDocument(instance: VideoEditInstance, next: VideoEditDocument, recordHistory: boolean): VideoEditDocument {
  validateVideoEditGraphicTextBudget(next, instance.document)
  if (recordHistory) { instance.past = [...instance.past.slice(-49), instance.document]; instance.future = [] }
  const before = instance.document
  // 剪辑名就是文件名，由文档会话同步；内容修改不能改名
  instance.document = { ...next, id: before.id, name: before.name, revision: instance.document.revision + 1 }
  rescaleSequenceViews(instance, before)
  reconcileSequenceView(instance)
  instance.version++; publishVideoEdit(true)
  if (recordHistory) notifyVideoEditContent(instance)
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
  instance.document = withInPlaceMetadata({ ...target, name: before.name, revision: instance.document.revision + 1 }, before); instance.version++
  rescaleSequenceViews(instance, before)
  reconcileSequenceView(instance)
  publishVideoEdit(true)
  notifyVideoEditContent(instance)
}
type VideoEditProgramControl = Partial<Pick<VideoEditInstance, 'frame' | 'playing' | 'playbackDirection'>>
export function validateVideoEditProgramControl(id: string, values: VideoEditProgramControl): void {
  const instance = requireVideoEditInstance(id)
  if (values.frame !== undefined && (!Number.isSafeInteger(values.frame) || values.frame < 0)) throw new Error('播放位置必须为非负整数帧。')
  if (values.frame !== undefined && values.frame > Math.floor(getActiveVideoEditSequence(instance).fps * 1800)) throw new Error('播放位置超出序列范围。')
  if (values.playbackDirection !== undefined && values.playbackDirection !== 1 && values.playbackDirection !== -1) throw new Error('播放方向无效。')
  if (values.playing !== undefined && typeof values.playing !== 'boolean') throw new Error('播放状态无效。')
}
/**
 * 设置“播放头自动选中片段”打开时（PR 选择跟随播放指示器），播放头移动顺带选中该帧最上面的可见片段；
 * 只改视图选区，不进撤销历史。调用方显式指定选区、或正在拖动参数时不覆盖。
 */
function followPlayheadSelection(instance: VideoEditInstance, values: Partial<Pick<VideoEditInstance, 'selection' | 'frame' | 'playing' | 'scrubbing' | 'playbackDirection'>>): typeof values {
  if (values.frame === undefined || values.selection !== undefined || gestures.has(instance) || !useSettingsStore.getState().videoEditSelectionFollowsPlayhead) return values
  const selection = videoEditClipUnderPlayhead(getActiveVideoEditSequence(instance), values.frame)
  return selection === instance.selection ? values : { ...values, selection }
}
export function setVideoEditView(id: string, values: Partial<Pick<VideoEditInstance, 'selection' | 'frame' | 'playing' | 'scrubbing' | 'playbackDirection'>>, observation = false): object {
  const instance = requireVideoEditInstance(id)
  validateVideoEditProgramControl(id, values)
  values = followPlayheadSelection(instance, values)
  if (Object.entries(values).every(([key, value]) => instance[key as keyof VideoEditInstance] === value)) return videoEditProgramCommandIdentity(id)
  const selectionChanged = values.selection !== undefined && values.selection !== instance.selection
  const selectedClipIds = values.selection !== undefined ? values.selection ? expandVideoEditSelection(getActiveVideoEditSequence(instance), [values.selection], videoEditPickRelations(instance.linkedSelection !== false)) : [] : instance.selectedClipIds
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
/**
 * Sequence In/Out marks select the half-open exported range (Out is exclusive, as marked by the O command);
 * without marks the whole sequence is exported. MP4 and subtitle files use the same range.
 */
export function videoEditExportRange(instance: VideoEditInstance, sequenceId = instance.activeSequenceId): { startFrame: number; endFrame: number } {
  const sequence = instance.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('序列不存在。')
  const marks = sequenceId === instance.activeSequenceId ? instance : instance.sequenceViews.get(sequenceId)
  const startFrame = marks?.inFrame ?? 0; const endFrame = marks?.outFrame ?? videoEditDuration(sequence)
  if (endFrame <= startFrame) throw new Error('入点之后没有可导出的内容，请调整序列入出点。')
  return { startFrame, endFrame }
}
export function getVideoEditTimelineView(id: string): VideoEditTimelineView {
  const instance = requireVideoEditInstance(id)
  return { selectedClipIds: [...instance.selectedClipIds], targetTrackIds: [...instance.targetTrackIds], tool: instance.tool, snapping: instance.snapping, zoom: instance.zoom, inFrame: instance.inFrame, outFrame: instance.outFrame, linkedSelection: instance.linkedSelection !== false }
}
export function validateVideoEditTimelineView(id: string, values: Partial<VideoEditTimelineView>): VideoEditTimelineView {
  const instance = requireVideoEditInstance(id); const sequence = getActiveVideoEditSequence(instance)
  const next = { ...getVideoEditTimelineView(id), ...values }
  // The stored selection is exactly what the user picked (Alt or Linked Selection off keeps one portion);
  // pickers expand relations before writing, so normalisation only checks membership and bounds.
  next.selectedClipIds = expandVideoEditSelection(sequence, next.selectedClipIds, false)
  next.linkedSelection ??= instance.linkedSelection !== false
  if (typeof next.linkedSelection !== 'boolean') throw new Error('链接选择开关无效。')
  next.targetTrackIds = [...new Set(next.targetTrackIds)]
  if (next.targetTrackIds.some(id => !sequence.tracks.some(track => track.id === id))) throw new Error('目标轨道不属于此序列。')
  if (!(VIDEO_EDIT_TIMELINE_TOOLS as readonly string[]).includes(next.tool) || typeof next.snapping !== 'boolean' || !Number.isFinite(next.zoom) || next.zoom < .1 || next.zoom > 20) throw new Error('时间线工具、吸附或缩放无效。')
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
  if (!['project', 'source', 'program', 'timeline', 'effects', 'content', 'tracking', 'lumetri'].includes(panel)) throw new Error('剪辑面板不存在。')
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
  if (next.selectedItemIds.some(itemId => !instance.document.items.some(item => item.id === itemId)) || next.selectedItemIds.length > 500) throw new Error('素材选区包含无效素材项。')
  if (next.selectedBinId && !instance.document.bins.some(bin => bin.id === next.selectedBinId)) throw new Error('目标素材箱不存在。')
  if (!next.openSequenceIds.length || next.openSequenceIds.some(sequenceId => !instance.document.sequences.some(sequence => sequence.id === sequenceId))) throw new Error('请至少保留一个有效的序列标签。')
  next.selectedItemIds = [...new Set(next.selectedItemIds)]; next.openSequenceIds = [...new Set(next.openSequenceIds)]
  if (JSON.stringify(next) === JSON.stringify(getVideoEditProjectView(id))) return
  Object.assign(instance, next)
  if (!next.openSequenceIds.includes(instance.activeSequenceId)) switchVideoEditSequence(id, next.openSequenceIds.at(-1)!)
  publishVideoEdit(true)
}
const VIDEO_EDIT_SAVE_FAILED = '剪辑未能保存到磁盘：修改仍保留在当前剪辑，并会自动重试。请检查项目文件夹是否只读、被其他程序占用或磁盘空间不足。'
/** 保存屏障：写完当前全部修改（文档会话的 flush）。失败时修改保留，会话按退避自动重试。 */
export async function saveVideoEdit(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  // 参数调整进行中时等它结束再写，保存的是调整后的结果
  for (let gesture = gestures.get(instance); gesture; gesture = gestures.get(instance)) await gesture.finished
  try { await instance.session.flush() } catch (error) {
    // 原始文件系统原因进日志；用户只需要知道修改保留了、该检查什么
    logger.error('剪辑保存失败', error, { event: 'video_edit.save.failed', context: { projectId: id } })
    throw new Error(VIDEO_EDIT_SAVE_FAILED, { cause: error })
  } finally { publishVideoEdit() }
  // 保存后顺带更新列表封面（后台进行，画面没变时不重复生成）
  void updateVideoEditProjectCover(instance.document)
}

/** 文档内容（剪辑的持久部分）：去掉外壳表达的 format / version / id / name / revision。 */
export function videoEditDocumentContent(document: VideoEditDocument): VideoEditDocumentContent {
  const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...content } = document
  return content as VideoEditDocumentContent
}
/** 文档内容 → 剪辑（完整 schema 校验）；内容读不懂时报错，原文件不动。 */
export function videoEditDocumentFromContent(content: unknown, meta: { id: string; name: string }, revision = 0): VideoEditDocument {
  const raw = { format: 'henji-video-project', version: 2, id: meta.id, name: meta.name, revision, ...(typeof content === 'object' && content !== null ? content : {}) }
  const parsed = videoEditDocumentSchema.safeParse(raw)
  // schema 路径是诊断信息，不是用户语言，只进日志
  if (!parsed.success) {
    logger.warn('剪辑文件内容不完整', { event: 'video_edit.document.invalid', context: { docId: meta.id, issues: parsed.error.issues.slice(0, 10).map(issue => ({ path: issue.path.join('.'), message: issue.message })) } })
    throw new Error('剪辑文件内容不完整或已损坏，无法打开；原文件未被修改。')
  }
  return parsed.data
}

/**
 * 项目文件夹里的素材只按位置引用（重要记录 006）：素材库的内容快照含原位置，项目被拷走、收集素材或移动后
 * 位置变了就永远对不上，会被误判为“源文件已改变”。所以落在剪辑所在项目文件夹里的素材去掉素材库关联，
 * 外部素材照旧按素材库快照核对。返回去掉后的剪辑；没有可去掉的返回 null。
 */
function detachProjectMediaAssets(document: VideoEditDocument, projectRoot: string): VideoEditDocument | null {
  const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const root = `${normalize(projectRoot)}/`
  let changed = false
  const media = document.media.map(item => {
    if (!item.assetId && !item.assetContent) return item
    if (!normalize(item.path).startsWith(root)) return item
    changed = true
    const { assetId: _assetId, assetContent: _assetContent, ...rest } = item
    return rest
  })
  return changed ? { ...document, media } : null
}
function projectRootOf(session: DocumentSession): string | null {
  return session.documentMeta.container.kind === 'project' ? parentFolderOf(session.documentMeta.path) : null
}

function sessionError(session: DocumentSession): string | null {
  return session.getState().status === 'failed' ? VIDEO_EDIT_SAVE_FAILED : null
}

/** 把一个已打开的剪辑文档会话接成实例：附着内容、同步名称，会话结束时自动拆掉。 */
async function bindVideoEditSession(session: DocumentSession, focus: boolean): Promise<VideoEditInstance> {
  const existing = instances.get(session.id)
  if (existing && existing.session === session && !session.isEnded) { if (focus) focusVideoEdit(session.id); return existing }
  const loaded = videoEditDocumentFromContent(session.getContent(), session.documentMeta)
  const root = projectRootOf(session)
  const detached = root ? detachProjectMediaAssets(loaded, root) : null
  const document = detached ?? loaded
  validateVideoEditGraphicTextBudget(document)
  const codeMetadata = await prepareVideoEditCodeMetadata(document)
  if (session.isEnded) throw new Error('剪辑在打开期间已关闭。')
  const view = defaultSequenceView(document.sequences[0])
  const instance = {
    document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id],
    session, past: [], future: [], ...view, playing: false, playbackDirection: 1, activePanel: 'timeline', busy: false, version: 0,
  } as unknown as VideoEditInstance
  Object.defineProperties(instance, {
    dirty: { get: () => session.dirty, enumerable: true },
    error: { get: () => sessionError(session), enumerable: true },
  })
  installVideoEditCodeMetadata(instance, codeMetadata)
  const listeners = new Set<() => void>()
  contentListeners.set(instance, listeners)
  const adapter: DocumentContentAdapter<VideoEditDocumentContent> = {
    // 参数调整进行中时写调整前的内容；提交后再标脏保存
    getContent: () => videoEditDocumentContent(withInPlaceMetadata(gestures.get(instance)?.before ?? instance.document, instance.document)),
    receiveContent: (content) => {
      // 冲突后“重新载入”、收集素材改写了引用：按新内容重建，撤销历史不跨版本
      cancelVideoEditGesture(instance)
      const before = instance.document
      const received = videoEditDocumentFromContent(content, { id: before.id, name: session.documentMeta.name }, before.revision + 1)
      const receivedRoot = projectRootOf(session)
      const receivedDetached = receivedRoot ? detachProjectMediaAssets(received, receivedRoot) : null
      instance.document = receivedDetached ?? received
      if (receivedDetached) queueMicrotask(() => notifyVideoEditContent(instance))
      instance.past = []; instance.future = []; instance.playing = false; instance.version++
      reconcileSequenceView(instance)
      void ensureVideoEditCodeDocumentMetadata(instance, instance.document).catch(error => logger.warn('重新载入后代码素材检查未完成', { event: 'video_edit.document.code_metadata_failed', error }))
      publishVideoEdit(true)
      void import('./videoEditInPlaceGeneration').then(inPlace => {
        if (!session.isEnded && instances.get(session.id) === instance) inPlace.restoreVideoEditInPlaceJobs(session.id)
      }).catch(error => logger.warn('重新载入后原地生成恢复未完成', { event: 'video_edit.in_place.reload.failed', error }))
    },
    subscribe: (onChange) => { listeners.add(onChange); return () => { listeners.delete(onChange) } },
  }
  const detach = session.attach(adapter as DocumentContentAdapter)
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe(); detach(); cancelVideoEditGesture(instance); instance.playing = false
    if (instances.get(session.id) === instance) instances.delete(session.id)
    if (activeId === session.id) activeId = instances.keys().next().value ?? null
    if (!instances.size) releaseVideoEditCodeCompiler()
    publishVideoEdit(true)
  }
  const unsubscribe = session.subscribe(() => {
    if (session.isEnded) { dispose(); return }
    const name = session.documentMeta.name
    if (instance.document.name !== name) { instance.document = { ...instance.document, name }; publishVideoEdit(true) } else publishVideoEdit()
  })
  disposers.set(instance, dispose)
  instances.set(session.id, instance)
  // 去掉了项目内素材的素材库关联：写回剪辑文件
  if (detached) session.markChanged()
  if (focus || !activeId) activeId = session.id
  publishVideoEdit(true)
  logger.info('剪辑已打开', { event: 'video_edit.document.open.completed', context: { docId: session.id, missing: session.getState().missingPaths.length } })
  // 打开即恢复（含后台打开），无需挂载时间线；只续查原任务，不重新生成。
  if (instance.document.inPlaceGenerations?.length) {
    const inPlace = await import('./videoEditInPlaceGeneration')
    if (!session.isEnded) inPlace.restoreVideoEditInPlaceJobs(session.id)
  }
  return instance
}

async function openSessionInstance(open: () => Promise<DocumentSession>, focus: boolean): Promise<VideoEditInstance> {
  const session = await open()
  try { return await bindVideoEditSession(session, focus) } catch (error) {
    // 内容读不懂（文件被手工改坏）：不留一个没有实例附着的会话
    if (!instances.has(session.id) && !session.isEnded) await session.discard()
    if (!instances.size) releaseVideoEditCodeCompiler()
    throw error
  }
}

/** 打开一份剪辑文档（按 ID，可带位置）；已打开时切到它。 */
export async function openVideoEditDocument(target: DocumentTarget, options: { focus?: boolean } = {}): Promise<VideoEditInstance> {
  assertApplicationWritesAllowed()
  const focus = options.focus ?? true
  const existing = instances.get(target.id)
  if (existing && !existing.session.isEnded) { if (focus) focusVideoEdit(target.id); return existing }
  if (leaving.has(target.id)) throw new Error('这份剪辑正在关闭，请稍后再打开。')
  try {
    return await openSessionInstance(() => documentRegistry().open(target), focus)
  } catch (error) {
    if (isDocumentServiceError(error, 'DocumentNotFoundError')) throw new Error('找不到这份剪辑文件，它可能已被移动或删除。')
    throw error
  }
}

/**
 * 新建项目（实施方案 2.2、2.8）：以草稿状态在“项目”文件夹里建项目，并在其中建同名主剪辑，
 * 登记为项目的主剪辑后打开。离开时按草稿项目询问“保存 / 不保存 / 取消”。
 */
export async function createVideoEditProject(): Promise<VideoEditInstance> {
  assertApplicationWritesAllowed()
  const registry = documentRegistry()
  const project = await registry.createProject()
  try {
    const instance = await openSessionInstance(() => registry.create({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: project.name, draft: false }), true)
    await documentOperations().setProjectMainDocument(project.id, instance.document.id)
    logger.info('新建剪辑项目', { event: 'video_edit.project.create.completed', context: { projectId: project.id, docId: instance.document.id } })
    return instance
  } catch (error) {
    // 建主剪辑失败时不留下空的草稿项目
    await documentOperations().trashProject(project).catch(cleanup => logger.warn('新建失败后清理草稿项目未完成', { event: 'video_edit.project.create.cleanup_failed', error: toError(cleanup) }))
    throw error
  }
}

/** 项目的主剪辑：项目说明登记的那份（须确在本项目里），否则最近编辑的一份，都没有时新建同名剪辑并登记。 */
async function ensureMainVideoEdit(project: ProjectSummary): Promise<DocumentTarget> {
  const operations = documentOperations()
  const list = () => operations.listDocuments({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, includeDrafts: true, includeMissing: false })
  let edits = await list()
  // 刚登记的外部项目（拷来的项目文件夹）里的文档要等扫描进索引：先扫描一次，避免误建一份同名主剪辑
  if (!edits.length) { await operations.refreshIndex(); edits = await list() }
  // 拷贝出来的项目里，项目说明记的可能还是原项目那份的 ID（副本已换新 ID）：只认本项目里真有的
  let main = edits.find(document => document.id === project.mainVideoEditId) ?? edits[0]
  if (!main) {
    const created = await operations.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: project.name })
    main = await operations.findDocument(created.id)
  }
  if (main.id !== project.mainVideoEditId) await operations.setProjectMainDocument(project.id, main.id)
  return { id: main.id, path: main.path }
}

/** 打开项目 = 打开它的主剪辑（没有就建一个）。 */
export async function openVideoEditProject(project: ProjectSummary): Promise<VideoEditInstance> {
  if (project.missing) throw new Error('找不到这个项目的文件夹，它可能已被移动、删除，或所在的盘没有连接。')
  return await openVideoEditDocument(await ensureMainVideoEdit(project))
}

/** 打开作品目录之外的项目文件夹：登记为外部位置后打开它的主剪辑。 */
export async function openVideoEditProjectFolder(folderPath: string): Promise<VideoEditInstance> {
  const project = await documentOperations().registerExternalProject(folderPath)
  return await openVideoEditProject(project)
}

/** 剪辑所在的项目（剪辑始终在项目里）。 */
export async function videoEditProjectOf(id: string): Promise<ProjectSummary> {
  const container = requireVideoEditInstance(id).session.documentMeta.container
  if (container.kind !== 'project') throw new Error('剪辑不在任何项目里。')
  return await documentOperations().findProject(container.projectId)
}

/**
 * 离开剪辑（返回项目列表）：等导出结束，草稿项目走通用的项目离开流程
 * （空项目直接移到回收站；有内容询问“保存 / 不保存 / 取消”，保存时起名、可另选位置），
 * 保存后主剪辑随项目改名；已保存的项目直接写完关闭。cancelled 时留在剪辑里，修改保留。
 */
export async function leaveVideoEditProject(id: string): Promise<DocumentLeaveOutcome> {
  const instance = requireVideoEditInstance(id)
  const previous = leaving.get(id)
  if (previous) return await previous
  if (instance.busy || activities.get(instance)?.size) throw new Error(videoEditBusyReason(id) ?? '请等待处理完成。')
  const operation = (async (): Promise<DocumentLeaveOutcome> => {
    cancelVideoEditGesture(instance); instance.playing = false; publishVideoEdit()
    const registry = documentRegistry()
    const container = instance.session.documentMeta.container
    const project = container.kind === 'project' ? await documentOperations().findProject(container.projectId).catch(() => null) : null
    let outcome: DocumentLeaveOutcome
    if (project?.draft) {
      const documents = await documentOperations().listDocuments({ container: { kind: 'project', projectId: project.id }, includeDrafts: true, includeMissing: false })
      const isEmpty = documents.every(document => document.id === id) && instance.session.isEmpty()
      outcome = await registry.leaveProject({ project, isEmpty })
      if (outcome === 'saved') await renameMainAfterSave(project, id)
    } else outcome = await registry.leave(id)
    // 留下来的剪辑（已保存或直接关闭）更新列表封面；不保存的草稿不用
    if (outcome === 'saved' || outcome === 'closed') void updateVideoEditProjectCover(instance.document)
    if (outcome !== 'cancelled') disposers.get(instance)?.()
    logger.info('离开剪辑', { event: 'video_edit.document.leave.completed', context: { docId: id, outcome, draftProject: Boolean(project?.draft) } })
    return outcome
  })()
  leaving.set(id, operation)
  try { return await operation } catch (error) {
    logger.warn('离开剪辑失败，修改已保留', { event: 'video_edit.document.leave.failed', error: toError(error), context: { docId: id } })
    throw error
  } finally { if (leaving.get(id) === operation) leaving.delete(id) }
}

/** 草稿项目保存（起名）后，原本与项目同名的主剪辑跟着改成新的项目名。 */
async function renameMainAfterSave(previous: ProjectSummary, mainId: string): Promise<void> {
  try {
    const operations = documentOperations()
    const saved = await operations.findProject(previous.id)
    const main = await operations.findDocument(mainId)
    if (main.name === previous.name && main.name !== saved.name) await operations.renameDocument({ id: main.id, path: main.path }, saved.name)
  } catch (error) {
    logger.warn('项目已保存，主剪辑未能随项目改名', { event: 'video_edit.project.rename_main_failed', error: toError(error), context: { projectId: previous.id } })
  }
}

/**
 * 写完并关闭剪辑（不询问；草稿项目保留草稿标记，下次在项目页提示恢复）。
 * 界面返回列表用 leaveVideoEditProject；这里供后台释放、测试与内部收尾。
 */
export function closeVideoEditProject(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  const previous = closing.get(instance)
  if (previous) return previous
  if (instance.busy || activities.get(instance)?.size) return Promise.reject(new Error(videoEditBusyReason(id) ?? '请等待处理完成。'))
  // 关闭期间拒绝新的修改与参数调整（assertVideoEditWritable）；并发关闭合并为一次；失败时留在原处、修改保留
  const operation = Promise.resolve().then(async () => {
    cancelVideoEditGesture(instance); instance.playing = false
    try { await instance.session.close() } catch (error) {
      logger.error('剪辑关闭前保存失败', error, { event: 'video_edit.close.failed', context: { projectId: id } })
      throw new Error(VIDEO_EDIT_SAVE_FAILED, { cause: error })
    }
    disposers.get(instance)?.()
  }).finally(() => { closing.delete(instance) })
  closing.set(instance, operation)
  return operation
}

/** 释放只为后台读写持有的剪辑（通用文档操作移到回收站前调用）：界面正在显示、导出中或正在离开时拒绝。 */
export async function releaseVideoEditDocument(id: string): Promise<boolean> {
  const instance = instances.get(id)
  if (!instance || instance.session.isEnded) return true
  if (instance.busy || activities.get(instance)?.size || leaving.has(id) || activeId === id) return false
  await closeVideoEditProject(id)
  return true
}

/** 剪辑此刻能否被整份改写（收集素材会让会话重新载入）：导出进行中或参数调整未完成时给出原因。通用文档操作也登记它。 */
export function videoEditBusyReason(id: string): string | null {
  const instance = instances.get(id)
  if (!instance) return null
  if (instance.busy) return '请等待导出完成或取消导出。'
  if ([...activities.get(instance) ?? []].some(value => value.startsWith('export:'))) return '仍有待导出的项目，请等待完成或在导出列表取消。'
  if (activities.get(instance)?.size) return '请等待字幕处理完成或在字幕面板取消。'
  if (gestures.has(instance)) return '请先完成当前参数调整。'
  return null
}

/**
 * 收集素材：把剪辑引用的外部文件复制进所在项目的“素材”并改写引用；片段来源引用的别处文档
 * （别的项目、作品目录里的画布、口播、图片文档）复制进项目（新 ID）并改指向副本（4.1）。
 * 返回复制的文件数、文档数与找不到的数量。
 */
export async function collectVideoEditMedia(id: string): Promise<{ copiedFiles: number; copiedDocuments: number; missing: number }> {
  const instance = requireVideoEditInstance(id)
  const busy = videoEditBusyReason(id)
  if (busy) throw new Error(busy)
  const result = await documentOperations().collectDocumentMedia(instance.session.target)
  logger.info('剪辑素材已收集', { event: 'video_edit.media.collect.completed', context: { docId: id, copiedFiles: result.copiedFiles, copiedDocuments: result.copiedDocuments ?? 0, missing: result.missingPaths.length } })
  return { copiedFiles: result.copiedFiles, copiedDocuments: result.copiedDocuments ?? 0, missing: result.missingPaths.length }
}

/**
 * 从剪辑文件回读并核对：磁盘上的内容是否就是 expected（默认当前内存里的剪辑）。
 * 两边都按完整 schema 规范化后比较（主进程保存的是类型 schema 的解析结果，字段顺序可能不同）。
 */
export async function verifyVideoEditSaved(id: string, expected?: VideoEditDocument): Promise<boolean> {
  const instance = requireVideoEditInstance(id)
  const read = await documentOperations().readDocument(instance.session.target)
  const meta = { id: instance.document.id, name: instance.document.name }
  const normalize = (content: unknown): string => JSON.stringify(videoEditDocumentFromContent(content, meta))
  return normalize(read.content) === normalize(videoEditDocumentContent(expected ?? instance.document))
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
// 剪辑内容由文档会话登记表在退出屏障里写完；这里只拦住进行中的导出并收起参数调整与播放
registerApplicationCloseGuard(async () => {
  for (const instance of instances.values()) { if (instance.busy || activities.get(instance)?.size) throw new Error(videoEditBusyReason(instance.document.id) ?? '请等待处理完成。'); cancelVideoEditGesture(instance); instance.playing = false }
})
