import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { createVideoEditDocument, createVideoEditSequence, changeVideoEditSequenceSettings, splitVideoEditClip, videoEditComposition, videoEditDocumentSchema, type VideoEditComposition, type VideoEditDocument, type VideoEditSequence, type VideoEditMedia } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { rescaleVideoEditFrame } from '@/core/videoEdit/time'
import { getPlatform } from '@/platform/runtime'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { installVideoEditCodeMetadata, prepareVideoEditCodeMetadata, readVideoEditCodeMetadata, releaseVideoEditCodeCompiler } from './videoEditCodeState'
import type { VideoEditCodeMetadata } from './videoEditCodeState'

const logger = createLogger('features.videoEdit')
export interface VideoEditInstance {
  document: VideoEditDocument
  activeSequenceId: string
  sequenceViews: Map<string, { selection: string | null; frame: number }>
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
  scrubbing?: boolean
  busy: boolean
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
    Object.assign(instance, instance.sequenceViews.get(instance.activeSequenceId) ?? { frame: 0, selection: null })
    instance.playing = false; instance.scrubbing = false
  }
  if (!getActiveVideoEditSequence(instance).clips.some(clip => clip.id === instance.selection)) instance.selection = null
  instance.selectedItemIds = instance.selectedItemIds.filter(id => instance.document.items.some(item => item.id === id))
  if (instance.selectedBinId && !instance.document.bins.some(bin => bin.id === instance.selectedBinId)) instance.selectedBinId = ''
  instance.openSequenceIds = instance.openSequenceIds.filter(id => instance.document.sequences.some(sequence => sequence.id === id))
  if (!instance.openSequenceIds.includes(instance.activeSequenceId)) instance.openSequenceIds.push(instance.activeSequenceId)
}
function rescaleSequenceViews(instance: VideoEditInstance, before: VideoEditDocument): void {
  for (const sequence of instance.document.sequences) {
    const previous = before.sequences.find(item => item.id === sequence.id)
    if (!previous || previous.frameRate.numerator * sequence.frameRate.denominator === sequence.frameRate.numerator * previous.frameRate.denominator) continue
    const view = instance.sequenceViews.get(sequence.id)
    if (view) view.frame = rescaleVideoEditFrame(view.frame, previous.frameRate, sequence.frameRate)
    if (instance.activeSequenceId === sequence.id) { instance.frame = rescaleVideoEditFrame(instance.frame, previous.frameRate, sequence.frameRate); instance.playing = false }
  }
}
export function switchVideoEditSequence(projectId: string, sequenceId: string): void {
  const instance = requireVideoEditInstance(projectId)
  if (!instance.document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
  if (instance.activeSequenceId === sequenceId) return
  cancelVideoEditGesture(instance)
  instance.sequenceViews.set(instance.activeSequenceId, { selection: instance.selection, frame: instance.frame })
  instance.activeSequenceId = sequenceId
  if (!instance.openSequenceIds.includes(sequenceId)) instance.openSequenceIds.push(sequenceId)
  Object.assign(instance, instance.sequenceViews.get(sequenceId) ?? { frame: 0, selection: null })
  instance.playing = false; instance.scrubbing = false; reconcileSequenceView(instance); publishVideoEdit()
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
  sequence.tracks = sequence.tracks.map(track => ({ ...track, id: crypto.randomUUID() }))
  sequence.clips = sequence.clips.map(clip => ({ ...clip, id: clips.get(clip.id)! }))
  sequence.annotations = sequence.annotations.map(mark => ({ ...mark, id: crypto.randomUUID(), clipId: clips.get(mark.clipId)! }))
  editVideoProject(projectId, document => ({ ...document, sequences: [...document.sequences, sequence] })); return sequence.id
}
export function deleteVideoEditSequence(projectId: string, sequenceId: string): void {
  editVideoProject(projectId, document => { if (document.sequences.length === 1) throw new Error('工程至少保留一个序列。'); const sequence = document.sequences.find(sequence => sequence.id === sequenceId); if (!sequence) throw new Error('目标序列不存在。'); if (sequence.clips.length || sequence.annotations.length) throw new Error('请先移除序列内的片段和标注，再移除序列。'); return { ...document, sequences: document.sequences.filter(sequence => sequence.id !== sequenceId) } })
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
function applyVideoEditDocument(instance: VideoEditInstance, update: (document: VideoEditDocument) => VideoEditDocument, recordHistory: boolean): VideoEditDocument {
  const next = videoEditDocumentSchema.parse(update(structuredClone(instance.document)))
  validateCodeMaterialDocument(next, readVideoEditCodeMetadata(instance, next))
  if (JSON.stringify(next) === JSON.stringify(instance.document)) return instance.document
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
export function setVideoEditView(id: string, values: Partial<Pick<VideoEditInstance, 'selection' | 'frame' | 'playing' | 'scrubbing'>>): void {
  const instance = requireVideoEditInstance(id)
  if (values.frame !== undefined && (!Number.isSafeInteger(values.frame) || values.frame < 0)) throw new Error('播放位置必须为非负整数帧。')
  if (Object.entries(values).every(([key, value]) => instance[key as keyof VideoEditInstance] === value)) return
  const selectionChanged = values.selection !== undefined && values.selection !== instance.selection
  if (selectionChanged) cancelVideoEditGesture(instance)
  Object.assign(instance, values)
  if (selectionChanged) publishVideoEdit(); else publishView()
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
  const instance: VideoEditInstance = { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id], path, dirty, error: null, past: [], future: [], selection: null, frame: 0, playing: false, busy: false, version: 0 }
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
export function splitSelectedVideoEdit(id: string): void { const instance = requireVideoEditInstance(id); if (instance.selection) editVideoSequence(id, instance.activeSequenceId, sequence => splitVideoEditClip(sequence, instance.selection!, instance.frame)) }
export function deleteVideoEditClip(id: string, clipId: string): void {
  const instance = requireVideoEditInstance(id)
  const sequence = instance.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
  if (!sequence) throw new Error('片段不存在。')
  editVideoSequence(id, sequence.id, sequence => ({ ...sequence, clips: sequence.clips.filter(clip => clip.id !== clipId), annotations: sequence.annotations.filter(mark => mark.clipId !== clipId) }))
  if (requireVideoEditInstance(id).selection === clipId) setVideoEditView(id, { selection: null })
}
registerApplicationCloseGuard(async () => {
  for (const instance of instances.values()) { if (instance.busy) throw new Error('剪辑工程正在导出，请等待或取消。'); cancelVideoEditGesture(instance); instance.playing = false; await saveVideoEdit(instance.document.id) }
})
