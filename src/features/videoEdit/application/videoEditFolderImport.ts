import { createLogger } from '@/core/logging'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, videoEditMediaPathKey, VIDEO_EDIT_IMPORT_EXTENSIONS } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { reportVideoEditImport, withVideoEditImportTask, type VideoEditImportProgress, type VideoEditImportTask } from './videoEditImportTask'

const logger = createLogger('features.videoEdit.folderImport')
const SYSTEM_FILE = /^(?:\..*|desktop\.ini|thumbs\.db|ehthumbs\.db)$/i
const IMPORTABLE = new RegExp(`\\.(?:${VIDEO_EDIT_IMPORT_EXTENSIONS.join('|')})$`, 'i')
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
export interface VideoEditImportFolder { path: string; name: string; files: string[]; folders: VideoEditImportFolder[] }
export interface VideoEditFolderImportResult { itemIds: string[]; skipped: number }
export interface VideoEditFolderImportOptions { signal?: AbortSignal; onProgress?: (progress: VideoEditImportProgress) => void }
interface Enumeration { visited: Set<string>; skipped: number; entries: number; signal?: AbortSignal; task?: VideoEditImportTask; onProgress?: VideoEditFolderImportOptions['onProgress'] }
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
    let cursor: string | undefined; let first = true; let accepted = false
    const children: VideoEditImportFolder[] = []
    try {
      do {
        state.signal?.throwIfAborted()
        const page = await getPlatform().system.fs.readDirPage(folder.path, cursor ? { cursor } : undefined)
        cursor = page.cursor
        state.signal?.throwIfAborted()
        if (first) {
          first = false
          const key = videoEditMediaPathKey(page.realPath)
          if (state.visited.has(key)) { state.skipped++; break }
          state.visited.add(key); accepted = true
          if (parent) parent.folders.push(folder); else rootRead = true
        }
        for (const entry of page.entries) {
          if (SYSTEM_FILE.test(entry.name)) continue
          state.entries++
          if (entry.unreadable) { state.skipped++; continue }
          const child = childPath(folder.path, entry.name)
          if (entry.isDirectory) children.push({ path: child, name: entry.name, files: [], folders: [] })
          else folder.files.push(child)
        }
        if (state.task) reportVideoEditImport(state.task, { phase: 'enumerating', completed: 0, total: state.entries }, state.onProgress)
      } while (cursor)
    } catch (error) {
      state.signal?.throwIfAborted()
      if (!parent && !accepted && error instanceof Error && /ENOTDIR/.test(error.message)) return undefined
      state.skipped++
      logger.info('跳过无法读取的目录', { event: 'video_edit.media.folder_import.skipped', error })
    } finally {
      if (cursor) await getPlatform().system.fs.readDirPage(folder.path, { cursor, close: true })
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
/** Stage bins, media and drop placement; commit once after cancellation checks. */
export async function importVideoEditPathsAndFolders(projectId: string, paths: readonly string[], binId?: string, afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument | Promise<VideoEditDocument>, options: VideoEditFolderImportOptions = {}): Promise<VideoEditFolderImportResult> {
  return withVideoEditImportTask(projectId, options.signal, async task => {
    const owner = requireVideoEditInstance(projectId); const baseline = owner.document
    const signal = task.controller.signal
    const state: Enumeration = { visited: new Set(), skipped: 0, entries: 0, signal, task, onProgress: options.onProgress }
    const folders: VideoEditImportFolder[] = []; const loose: string[] = []
    logger.info('文件夹导入开始', { event: 'video_edit.media.folder_import.start', context: { projectId, roots: paths.length } })
    try {
      for (const path of paths) { const before = state.skipped; const folder = await readVideoEditImportFolder(path, state); if (folder) folders.push(folder); else if (state.skipped === before) loose.push(path) }
      signal.throwIfAborted()
      if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('导入期间原剪辑已改变，请重新导入。')
      let skipped = state.skipped
      const files = new Map<string, { path: string; folder: VideoEditImportFolder }>()
      const folderNodes = [...folderEntries(folders)]
      for (const { folder } of folderNodes) for (const path of folder.files) { if (IMPORTABLE.test(path)) files.set(videoEditMediaPathKey(path), { path, folder }); else skipped++ }
      const existing = new Set(baseline.items.map(item => item.id))
      let itemIds: string[] = []
      const place = async (document: VideoEditDocument, ids: string[]): Promise<VideoEditDocument> => {
        const bins = [...document.bins]; const items = [...document.items]; const created = new Map<VideoEditImportFolder, string>()
        for (const { folder, parent } of folderNodes) {
          const parentId = parent ? created.get(parent) : binId; const id = crypto.randomUUID()
          bins.push({ id, name: folder.name.slice(0, 200), ...(parentId ? { parentId } : {}) }); created.set(folder, id)
        }
        const indexes = new Map(items.map((item, index) => [item.id, index])); const media = new Map(document.media.map(media => [media.id, media]))
        itemIds = ids.map(id => {
          const index = indexes.get(id)!; const item = items[index]; const path = media.get(item.mediaId!)?.path
          const folder = path ? files.get(videoEditMediaPathKey(path))?.folder : undefined
          if (!folder) return id
          const target = created.get(folder)!
          if (existing.has(id)) { const copy = { ...item, id: crypto.randomUUID(), binId: target }; items.push(copy); return copy.id }
          items[index] = { ...item, binId: target }; return id
        })
        const candidate = { ...document, bins, items }
        return afterImport ? afterImport(candidate, itemIds) : candidate
      }
      const sources = [...loose, ...[...files.values()].map(file => file.path)].map(path => ({ path }))
      if (sources.length) await importVideoEditSources(projectId, sources, binId, signal, place, [], { task, onProgress: options.onProgress,
        ...(folders.length ? { skipUnreadable: (path: string, reason: unknown) => { skipped++; logger.info('跳过无法读取的素材', { event: 'video_edit.media.folder_import.skipped', error: reason, context: { projectId, extension: path.split('.').at(-1)?.toLowerCase() } }) } } : {}) })
      else if (folderNodes.length) {
        const candidate = await place(structuredClone(baseline), []); signal.throwIfAborted()
        if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('导入期间原剪辑已改变，请重新导入。')
        editVideoProject(projectId, () => candidate)
      }
      logger.info('文件夹导入完成', { event: 'video_edit.media.folder_import.completed', context: { projectId, items: itemIds.length, skipped } })
      return { itemIds, skipped }
    } catch (error) { logger.debug('文件夹导入未完成', { event: 'video_edit.media.folder_import.failed', error, context: { projectId, cancelled: signal.aborted } }); throw error }
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
