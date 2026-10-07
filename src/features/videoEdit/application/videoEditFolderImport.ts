import { createLogger } from '@/core/logging'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { VideoEditSequenceFrameRateRequired } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, videoEditMediaPathKey, VIDEO_EDIT_IMPORT_EXTENSIONS } from './videoEditMedia'
import { editVideoEditImportGroup, finishVideoEditImportGroup, rollbackVideoEditImportGroup, waitVideoEditImportEdit, mergeVideoEditImportDocument, requireVideoEditInstance, listVideoEditInstances, type VideoEditImportEditGroup } from './videoEditService'
import { useSettingsStore } from '@/stores/settingsStore'
import { reportVideoEditImport, withVideoEditImportTask, type VideoEditImportProgress, type VideoEditImportTask } from './videoEditImportTask'

const logger = createLogger('features.videoEdit.folderImport')
const SYSTEM_FILE = /^(?:\..*|desktop\.ini|thumbs\.db|ehthumbs\.db)$/i
const IMPORTABLE = new RegExp(`\\.(?:${VIDEO_EDIT_IMPORT_EXTENSIONS.join('|')})$`, 'i')
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
export interface VideoEditImportFolder { path: string; name: string; files: string[]; folders: VideoEditImportFolder[] }
export class VideoEditPartialImportFailure extends Error {
  constructor(readonly imported: number, readonly cancelled: boolean, cause: unknown) { super(cancelled ? '导入已取消，已导入部分已保留。' : '导入未完成，已导入部分已保留。', { cause }); this.name = cancelled ? 'AbortError' : 'VideoEditPartialImportFailure' }
}
export interface VideoEditFolderImportResult { itemIds: string[]; skipped: number }
export interface VideoEditFolderImportOptions { signal?: AbortSignal; onProgress?: (progress: VideoEditImportProgress) => void }
interface Enumeration { visited: Set<string>; skipped: number; entries: number; signal?: AbortSignal; task?: VideoEditImportTask; onProgress?: VideoEditFolderImportOptions['onProgress']; onFolder?: (folder: VideoEditImportFolder, parent?: VideoEditImportFolder) => void | Promise<void> }
function childPath(parent: string, name: string): string { return `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${name}` }
function baseName(path: string): string { return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path }

/** Iterative traversal: realpath detects junction/symlink cycles; IPC pages bound I/O and cancellation latency. */
export async function readVideoEditImportFolder(path: string, state: Enumeration = { visited: new Set(), skipped: 0, entries: 0 }): Promise<VideoEditImportFolder | undefined> {
  const root: VideoEditImportFolder = { path, name: baseName(path), files: [], folders: [] }
  const pending = [{ folder: root, parent: undefined as VideoEditImportFolder | undefined }]
  let rootRead = false
  while (pending.length) {
    state.signal?.throwIfAborted()
    const { folder, parent } = pending.pop()!
    const readPath = folder.path
    let cursor: string | undefined; let first = true; let accepted = false
    const children: VideoEditImportFolder[] = []
    let materializing = false
    try {
      do {
        state.signal?.throwIfAborted()
        const page = await getPlatform().system.fs.readDirPage(readPath, cursor ? { cursor } : undefined)
        cursor = page.cursor
        state.signal?.throwIfAborted()
        if (first) {
          first = false
          const key = videoEditMediaPathKey(page.realPath)
          if (state.visited.has(key)) { state.skipped++; break }
          state.visited.add(key); accepted = true
          folder.path = page.realPath
          materializing = true; await state.onFolder?.(folder, parent); materializing = false
          if (parent) parent.folders.push(folder); else rootRead = true
        }
        for (const entry of page.entries) {
          if (SYSTEM_FILE.test(entry.name)) continue
          if (!entry.isDirectory) state.entries++
          if (entry.unreadable) { state.skipped++; continue }
          const child = childPath(folder.path, entry.name)
          if (entry.isDirectory) children.push({ path: child, name: entry.name, files: [], folders: [] })
          else folder.files.push(child)
        }
        if (state.task) reportVideoEditImport(state.task, { phase: 'enumerating', completed: 0, total: state.entries, discovered: state.entries, totalKnown: false }, state.onProgress)
      } while (cursor)
    } catch (error) {
      state.signal?.throwIfAborted()
      if (materializing) throw error
      if (!parent && !accepted && error instanceof Error && /ENOTDIR/.test(error.message)) return undefined
      state.skipped++
      logger.info('跳过无法读取的目录', { event: 'video_edit.media.folder_import.skipped', error })
    } finally {
      if (cursor) await getPlatform().system.fs.readDirPage(readPath, { cursor, close: true })
    }
    folder.files.sort(collator.compare)
    children.sort((a, b) => collator.compare(a.name, b.name))
    for (let index = children.length - 1; index >= 0; index--) pending.push({ folder: children[index], parent: folder })
  }
  return rootRead ? root : undefined
}
function* folderEntries(folders: readonly VideoEditImportFolder[]): Generator<{ folder: VideoEditImportFolder; parent?: VideoEditImportFolder }> {
  const pending: Array<{ folder: VideoEditImportFolder; parent?: VideoEditImportFolder }> = [...folders].reverse().map(folder => ({ folder }))
  while (pending.length) {
    const current = pending.pop()!; yield current
    for (let index = current.folder.folders.length - 1; index >= 0; index--) pending.push({ folder: current.folder.folders[index], parent: current.folder })
  }
}
export function planVideoEditFolderImport(folders: readonly VideoEditImportFolder[]): { files: Array<{ path: string; chain: string[] }>; unsupported: number } {
  const files: Array<{ path: string; chain: string[] }> = []; let unsupported = 0
  const parents = new Map<VideoEditImportFolder, VideoEditImportFolder>()
  for (const { folder, parent } of folderEntries(folders)) {
    if (parent) parents.set(folder, parent)
    for (const path of folder.files) {
      if (!IMPORTABLE.test(path)) { unsupported++; continue }
      const chain: string[] = []
      for (let current: VideoEditImportFolder | undefined = folder; current; current = parents.get(current)) chain.push(current.name)
      files.push({ path, chain: chain.reverse() })
    }
  }
  return { files, unsupported }
}
/** Enumeration creates bins immediately, including for queued requests; probing commits bounded batches. */
export async function importVideoEditPathsAndFolders(projectId: string, paths: readonly string[], binId?: string, afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument | Promise<VideoEditDocument>, options: VideoEditFolderImportOptions = {}): Promise<VideoEditFolderImportResult> {
  const owner = requireVideoEditInstance(projectId)
  const settings = useSettingsStore.getState()
  const createBins = settings.videoEditImportFolderBins; const duplicatePolicy = settings.videoEditDuplicatePolicy
  const group: VideoEditImportEditGroup = { owner }
  const createdBins = new Set<string>(); const targets = new Map<VideoEditImportFolder, string | undefined>()
  const createdMedia = new Set<string>(); const createdItems = new Set<string>()
  const folders: VideoEditImportFolder[] = []; const loose: string[] = []; const itemIds: string[] = []
  let state: Enumeration; let succeeded = false
  const commit = (update: (document: VideoEditDocument) => VideoEditDocument): VideoEditDocument => {
    const before = owner.document
    const next = editVideoEditImportGroup(group, update)
    const media = new Set(before.media.map(value => value.id)); const items = new Set(before.items.map(value => value.id))
    for (const value of next.media) if (!media.has(value.id)) createdMedia.add(value.id)
    for (const value of next.items) if (!items.has(value.id)) createdItems.add(value.id)
    return next
  }
  const cleanEmptyBins = async (): Promise<void> => {
    if (succeeded || !createdBins.size || !listVideoEditInstances().includes(owner) || !group.boundary || !owner.past.includes(group.boundary)) return
    await waitVideoEditImportEdit(owner)
    // Keep bins containing imported files, sequences or user-created child bins, including their ancestors.
    const used = new Set([...owner.document.items.map(item => item.binId), ...owner.document.sequences.map(sequence => sequence.binId), ...owner.document.bins.filter(bin => !createdBins.has(bin.id)).map(bin => bin.id)])
    const parents = new Map(owner.document.bins.map(bin => [bin.id, bin.parentId]))
    for (const id of [...used]) { const visited = new Set<string>(); for (let parent = id; parent && !visited.has(parent); parent = parents.get(parent)) { visited.add(parent); used.add(parent) } }
    const remove = new Set([...createdBins].filter(id => !used.has(id)))
    if (remove.size) commit(document => ({ ...document, bins: document.bins.filter(bin => !remove.has(bin.id)) }))
    if (group.boundary && JSON.stringify({ ...group.boundary, revision: 0 }) === JSON.stringify({ ...owner.document, revision: 0 })) owner.past = owner.past.filter(snapshot => snapshot !== group.boundary)
  }
  return withVideoEditImportTask(projectId, options.signal, async task => {
    const signal = task.controller.signal
    let skipped = state.skipped
    const files: Array<{ path: string; binId?: string }> = loose.map(path => ({ path, ...(binId ? { binId } : {}) }))
    for (const { folder } of folderEntries(folders)) for (const path of folder.files) {
      if (!IMPORTABLE.test(path)) { skipped++; continue }
      files.push({ path, ...(targets.get(folder) ? { binId: targets.get(folder) } : {}) })
    }
    let processed = task.total - files.length
    task.skipped = skipped
    const report = (): void => reportVideoEditImport(task, { phase: 'probing', completed: processed, total: task.total, totalKnown: true }, options.onProgress)
    report()
    let placing = false
    try {
      // Reuse the authoritative media importer and its two-decoder concurrency, not a second probe pipeline.
      for (let offset = 0; offset < files.length;) {
        signal.throwIfAborted()
        const target = files[offset].binId
        const batch: typeof files = []
        while (offset < files.length && files[offset].binId === target && batch.length < 32) batch.push(files[offset++])
        const media = new Map(owner.document.media.map(value => [value.id, videoEditMediaPathKey(value.path)]))
        const existing = new Map(owner.document.items.filter(item => item.binId === target && item.mediaId).map(item => [media.get(item.mediaId!)!, item.id]))
        const sources: Array<{ path: string }> = []; const seen = new Set<string>()
        for (const file of batch) {
          const key = videoEditMediaPathKey(file.path); const id = existing.get(key)
          if (duplicatePolicy === 'skip' && (id || seen.has(key))) { skipped++; processed++; if (id && afterImport) itemIds.push(id) }
          else { sources.push({ path: file.path }); seen.add(key) }
        }
        task.skipped = skipped
        if (sources.length) itemIds.push(...await importVideoEditSources(projectId, sources, target, signal, undefined, [], {
          task, commit, duplicatePolicy, progressOffset: processed, progressTotal: task.total, onProgress: options.onProgress,
          ...(folders.length ? { skipUnreadable: (path: string, reason: unknown) => { skipped++; logger.info('跳过无法读取的素材', { event: 'video_edit.media.folder_import.skipped', error: reason, context: { projectId, extension: path.split('.').at(-1)?.toLowerCase() } }) } } : {}),
        }))
        processed += sources.length; task.skipped = skipped; report()
      }
      if (afterImport && itemIds.length) {
        placing = true
        await waitVideoEditImportEdit(owner, signal)
        const before = owner.document; const next = await afterImport(structuredClone(before), itemIds)
        signal.throwIfAborted()
        if (requireVideoEditInstance(projectId) !== owner || owner.document !== before) throw new Error('导入落点已改变，请重新拖入。')
        commit(document => mergeVideoEditImportDocument(document, before, next))
        placing = false
      }
      signal.throwIfAborted(); succeeded = true
      logger.info('文件夹导入完成', { event: 'video_edit.media.folder_import.completed', context: { projectId, items: task.imported, skipped } })
      return { itemIds, skipped }
    } catch (error) {
      logger.debug('文件夹导入未完成', { event: 'video_edit.media.folder_import.failed', error, context: { projectId, cancelled: signal.aborted } })
      // Placement preconditions (including frame-rate confirmation) reject the whole drop.
      // Cancellation and failures while importing still keep the already imported portion.
      if (placing && !signal.aborted) {
        await rollbackVideoEditImportGroup(group, document => ({
          ...document,
          media: document.media.filter(value => !createdMedia.has(value.id)),
          items: document.items.filter(value => !createdItems.has(value.id)),
          bins: document.bins.filter(value => !createdBins.has(value.id)),
        }))
        // The confirmation must not refer to a bin that this rejected request just removed.
        if (error instanceof VideoEditSequenceFrameRateRequired && error.settings.binId && createdBins.has(error.settings.binId)) {
          if (binId && owner.document.bins.some(bin => bin.id === binId)) error.settings.binId = binId
          else delete error.settings.binId
        }
        task.imported = 0
        throw error
      }
      if (task.imported && group.boundary && owner.past.includes(group.boundary)) throw new VideoEditPartialImportFailure(task.imported, signal.aborted, error)
      throw error
    }
  }, {
    prepare: async task => {
      if (binId && !owner.document.bins.some(bin => bin.id === binId)) throw new Error('目标素材箱不存在。')
      const signal = task.controller.signal
      state = { visited: new Set(), skipped: 0, entries: 0, signal, task, onProgress: options.onProgress, onFolder: async (folder, parent) => {
        await waitVideoEditImportEdit(owner, signal)
        const parentId = parent ? targets.get(parent) : binId
        if (!createBins) { targets.set(folder, binId); return }
        const existing = owner.document.bins.find(bin => bin.parentId === parentId && bin.sourceFolderPath && videoEditMediaPathKey(bin.sourceFolderPath) === videoEditMediaPathKey(folder.path))
        if (existing) { targets.set(folder, existing.id); return }
        const bin = { id: crypto.randomUUID(), name: folder.name.slice(0, 200), sourceFolderPath: folder.path, ...(parentId ? { parentId } : {}) }
        commit(document => ({ ...document, bins: [...document.bins, bin] })); createdBins.add(bin.id); targets.set(folder, bin.id)
      } }
      logger.info('文件夹导入开始', { event: 'video_edit.media.folder_import.start', context: { projectId, roots: paths.length } })
      for (const path of paths) {
        const skipped = state.skipped; const folder = await readVideoEditImportFolder(path, state)
        if (folder) folders.push(folder)
        else if (state.skipped === skipped) { loose.push(path); state.entries++ }
      }
      signal.throwIfAborted()
      reportVideoEditImport(task, { phase: 'probing', completed: 0, total: state.entries, discovered: state.entries, totalKnown: true }, options.onProgress)
    }, cleanup: async () => { try { await cleanEmptyBins() } finally { finishVideoEditImportGroup(group) } },
  })
}
export async function chooseVideoEditFolders(projectId: string, binId?: string, options: VideoEditFolderImportOptions = {}): Promise<VideoEditFolderImportResult> {
  const owner = requireVideoEditInstance(projectId)
  options.signal?.throwIfAborted()
  const selected = await getPlatform().system.dialog.open({ directory: true, multiple: true })
  options.signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新导入。')
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  return paths.length ? importVideoEditPathsAndFolders(projectId, paths, binId, undefined, options) : { itemIds: [], skipped: 0 }
}
