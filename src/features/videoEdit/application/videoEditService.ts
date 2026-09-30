import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { createVideoEditDocument, splitVideoEditClip, videoEditDocumentSchema, type VideoEditDocument, type VideoEditMedia, type VideoEditClip } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('features.videoEdit')
export interface VideoEditInstance {
  document: VideoEditDocument
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
export function focusVideoEdit(id: string): void { requireVideoEditInstance(id); activeId = id; publishVideoEdit() }
export function editVideoProject(id: string, update: (document: VideoEditDocument) => VideoEditDocument): VideoEditDocument {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id)
  const next = videoEditDocumentSchema.parse(update(structuredClone(instance.document)))
  if (JSON.stringify(next) === JSON.stringify(instance.document)) return instance.document
  instance.past = [...instance.past.slice(-49), instance.document]; instance.future = []
  instance.document = { ...next, revision: instance.document.revision + 1 }
  instance.dirty = true; instance.error = null; instance.version++; publishVideoEdit(true)
  scheduleVideoEditSave(id)
  return instance.document
}
export function undoVideoEdit(id: string, redo = false): void {
  assertApplicationWritesAllowed()
  const instance = requireVideoEditInstance(id)
  const target = redo ? instance.future.shift() : instance.past.pop()
  if (!target) return
  if (redo) instance.past.push(instance.document); else instance.future.unshift(instance.document)
  instance.document = { ...target, revision: instance.document.revision + 1 }; instance.version++; instance.dirty = true
  if (!instance.document.clips.some(clip => clip.id === instance.selection)) instance.selection = null
  publishVideoEdit(true)
  scheduleVideoEditSave(id)
}
export function setVideoEditView(id: string, values: Partial<Pick<VideoEditInstance, 'selection' | 'frame' | 'playing' | 'scrubbing'>>): void {
  const instance = requireVideoEditInstance(id)
  if (values.frame !== undefined && (!Number.isSafeInteger(values.frame) || values.frame < 0)) throw new Error('播放位置必须为非负整数帧。')
  if (Object.entries(values).every(([key, value]) => instance[key as keyof VideoEditInstance] === value)) return
  const selectionChanged = values.selection !== undefined && values.selection !== instance.selection
  Object.assign(instance, values)
  if (selectionChanged) publishVideoEdit(); else publishView()
}
export async function saveVideoEdit(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  if (instance.saving) return instance.saving
  logger.info('保存剪辑工程', { event: 'video_edit.save.start', context: { projectId: id } })
  const saving = (async () => {
    while (instance.dirty) {
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
function attach(document: VideoEditDocument, path: string, dirty: boolean): VideoEditInstance {
  const existing = instances.get(document.id)
  if (existing) { if (existing.path !== path) throw new Error('此工程已从另一位置打开，请先关闭后再打开副本。'); focusVideoEdit(document.id); return existing }
  const instance: VideoEditInstance = { document, path, dirty, error: null, past: [], future: [], selection: null, frame: 0, playing: false, busy: false, version: 0 }
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
  const document = videoEditDocumentSchema.parse(JSON.parse(await getPlatform().system.fs.readTextFile(chosen)))
  for (const media of document.media) await getPlatform().media.allowRoot(await getPlatform().system.paths.dirname(media.path))
  return attach(document, chosen, false)
}
export async function closeVideoEditProject(id: string): Promise<void> {
  const instance = requireVideoEditInstance(id)
  if (instance.busy) throw new Error('请等待导出完成或取消导出。')
  instance.playing = false
  await saveVideoEdit(id)
  const timer = autosaves.get(id); if (timer !== undefined) clearTimeout(timer)
  autosaves.delete(id); retryDelays.delete(id)
  instances.delete(id); if (activeId === id) activeId = instances.keys().next().value ?? null; publishVideoEdit(true)
}
export function appendVideoEditMedia(id: string, media: VideoEditMedia): void {
  editVideoProject(id, document => ({ ...document, media: [...document.media, media] }))
}
export function appendVideoEditClip(id: string, mediaId?: string, placement?: { frame: number; track: number }): void {
  const instance = requireVideoEditInstance(id)
  const media = instance.document.media.find(item => item.id === mediaId)
  if (mediaId && !media) throw new Error('素材不存在。')
  const clip: VideoEditClip = { id: crypto.randomUUID(), mediaId, name: media?.name ?? '文字', kind: media?.kind ?? 'text', track: media?.kind === 'audio' ? 0 : 1, start: instance.frame, duration: media && media.kind !== 'image' ? Math.max(1, Math.floor(media.durationSeconds * instance.document.fps)) : instance.document.fps * 3, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: media ? '' : '输入文字' }
  if (placement) { clip.start = placement.frame; clip.track = placement.track }
  editVideoProject(id, document => ({ ...document, clips: [...document.clips, clip] })); setVideoEditView(id, { selection: clip.id })
}
export function splitSelectedVideoEdit(id: string): void { const instance = requireVideoEditInstance(id); if (instance.selection) editVideoProject(id, document => splitVideoEditClip(document, instance.selection!, instance.frame)) }
export function deleteVideoEditClip(id: string, clipId: string): void {
  editVideoProject(id, document => ({ ...document, clips: document.clips.filter(clip => clip.id !== clipId), annotations: document.annotations.filter(mark => mark.clipId !== clipId) }))
  if (requireVideoEditInstance(id).selection === clipId) setVideoEditView(id, { selection: null })
}
registerApplicationCloseGuard(async () => {
  for (const instance of instances.values()) { if (instance.busy) throw new Error('剪辑工程正在导出，请等待或取消。'); instance.playing = false; await saveVideoEdit(instance.document.id) }
})
