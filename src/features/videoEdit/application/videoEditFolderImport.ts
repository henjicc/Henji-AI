import { createLogger } from '@/core/logging'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { importVideoEditSources, sameVideoEditMediaPath, VIDEO_EDIT_IMPORT_EXTENSIONS } from './videoEditMedia'
import { requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.folderImport')
/** 文件夹层级与条目上限：防止误拖整个磁盘把主进程枚举拖住。 */
const MAX_DEPTH = 16
const MAX_ENTRIES = 5000
/** 系统生成的隐藏文件：不导入，也不算进“跳过”。 */
const SYSTEM_FILE = /^(?:\..*|desktop\.ini|thumbs\.db|ehthumbs\.db)$/i
const IMPORTABLE = new RegExp(`\\.(?:${VIDEO_EDIT_IMPORT_EXTENSIONS.join('|')})$`, 'i')

export interface VideoEditImportFolder { path: string; name: string; files: string[]; folders: VideoEditImportFolder[] }
export interface VideoEditFolderImportResult { itemIds: string[]; skipped: number }

function childPath(parent: string, name: string): string { const separator = parent.includes('\\') ? '\\' : '/'; return parent.endsWith(separator) ? `${parent}${name}` : `${parent}${separator}${name}` }
function baseName(path: string): string { return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path }
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/**
 * 目录由主进程枚举（`fs.readDir` IPC），渲染层不碰 Node。读不出目录（本身是文件、已移走）时返回 undefined，由调用方当文件处理。
 */
export async function readVideoEditImportFolder(path: string, budget = { entries: 0 }, depth = 0): Promise<VideoEditImportFolder | undefined> {
  let entries: Awaited<ReturnType<ReturnType<typeof getPlatform>['system']['fs']['readDir']>>
  try { entries = await getPlatform().system.fs.readDir(path) } catch { return undefined }
  budget.entries += entries.length
  if (budget.entries > MAX_ENTRIES) throw new Error(`文件夹内的文件超过 ${MAX_ENTRIES} 个，请拖入更具体的子文件夹。`)
  const folder: VideoEditImportFolder = { path, name: baseName(path), files: [], folders: [] }
  for (const entry of [...entries].sort((a, b) => collator.compare(a.name, b.name))) {
    if (SYSTEM_FILE.test(entry.name)) continue
    const child = childPath(path, entry.name)
    if (!entry.isDirectory) { folder.files.push(child); continue }
    if (depth + 1 >= MAX_DEPTH) throw new Error(`文件夹层级超过 ${MAX_DEPTH} 层，请拖入更具体的子文件夹。`)
    const nested = await readVideoEditImportFolder(child, budget, depth + 1)
    if (nested) folder.folders.push(nested)
  }
  return folder
}

/** 每个可导入文件及它所在的文件夹链（从拖入的顶层文件夹起）；不支持的格式只计数。 */
export function planVideoEditFolderImport(folders: readonly VideoEditImportFolder[]): { files: Array<{ path: string; chain: string[] }>; unsupported: number } {
  const files: Array<{ path: string; chain: string[] }> = []; let unsupported = 0
  const visit = (folder: VideoEditImportFolder, chain: string[]): void => {
    const current = [...chain, folder.name]
    for (const path of folder.files) { if (IMPORTABLE.test(path)) files.push({ path, chain: current }); else unsupported++ }
    for (const child of folder.folders) visit(child, current)
  }
  for (const folder of folders) visit(folder, [])
  return { files, unsupported }
}

/**
 * Premiere 拖入文件夹：按文件夹层级建同名素材箱（放在 `binId` 下），其中的素材进对应素材箱；不支持或读不出的文件跳过并计数。
 * 混合拖入的散文件放在 `binId`。只有含可导入素材的文件夹才建素材箱。全部写入是一步编辑。
 * 没有文件夹时与普通导入完全一致（散文件不按扩展名过滤、读不出就报错）。
 */
export async function importVideoEditPathsAndFolders(projectId: string, paths: readonly string[], binId?: string, afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument | Promise<VideoEditDocument>): Promise<VideoEditFolderImportResult> {
  const owner = requireVideoEditInstance(projectId)
  const budget = { entries: 0 }; const folders: VideoEditImportFolder[] = []; const loose: string[] = []
  for (const path of paths) { const folder = await readVideoEditImportFolder(path, budget); if (folder) folders.push(folder); else loose.push(path) }
  if (!folders.length) return { itemIds: await importVideoEditSources(projectId, loose.map(path => ({ path })), binId, undefined, afterImport), skipped: 0 }
  const plan = planVideoEditFolderImport(folders)
  let skipped = plan.unsupported
  const chains = new Map(plan.files.map(file => [file.path, file.chain]))
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新导入。')
  const existing = new Set(owner.document.items.map(item => item.id))
  const sources = [...loose, ...plan.files.map(file => file.path)].map(path => ({ path }))
  if (!sources.length) { logger.info('文件夹里没有可导入的素材', { event: 'video_edit.media.folder_import.empty', context: { projectId, skipped } }); return { itemIds: [], skipped } }
  const placeInBins = (document: VideoEditDocument, ids: string[]): { document: VideoEditDocument; ids: string[] } => {
    const bins = [...document.bins]; const items = [...document.items]; const created = new Map<string, string>()
    const binFor = (chain: string[]): string | undefined => {
      let parent = binId
      for (let depth = 1; depth <= chain.length; depth++) {
        const key = chain.slice(0, depth).join('\u0000')
        if (!created.has(key)) { const id = crypto.randomUUID(); bins.push({ id, name: chain[depth - 1].slice(0, 200), ...(parent ? { parentId: parent } : {}) }); created.set(key, id) }
        parent = created.get(key)
      }
      return parent
    }
    const placed = ids.map(id => {
      const index = items.findIndex(item => item.id === id); const item = items[index]
      const path = document.media.find(media => media.id === item.mediaId)?.path
      const chain = path ? [...chains].find(([file]) => sameVideoEditMediaPath(file, path))?.[1] : undefined
      if (!chain) return id
      const target = binFor(chain)
      // 原来就在目标素材箱里的同一素材项不挪走：在文件夹素材箱里另建一项（Premiere 也是新建）。
      if (existing.has(id)) { const copy = { ...item, id: crypto.randomUUID(), ...(target ? { binId: target } : {}) }; items.push(copy); return copy.id }
      items[index] = { ...item, ...(target ? { binId: target } : {}) }
      return id
    })
    if (bins.length > 200) throw new Error('导入后素材箱会超过 200 个，请分批导入文件夹。')
    return { document: { ...document, bins, items }, ids: placed }
  }
  let itemIds: string[] = []
  await importVideoEditSources(projectId, sources, binId, undefined, async (document, ids) => {
    const result = placeInBins(document, ids); itemIds = result.ids
    return afterImport ? afterImport(result.document, result.ids) : result.document
  }, [], { skipUnreadable: (path, reason) => { skipped++; logger.info('跳过无法读取的素材', { event: 'video_edit.media.folder_import.skipped', error: reason, context: { projectId, extension: path.split('.').at(-1)?.toLowerCase() } }) } })
  logger.info('文件夹导入完成', { event: 'video_edit.media.folder_import.completed', context: { projectId, folders: folders.length, items: itemIds.length, skipped } })
  return { itemIds, skipped }
}

/** 导入对话框的“导入文件夹”：选一个或多个文件夹，按同样的规则建素材箱。 */
export async function chooseVideoEditFolders(projectId: string, binId?: string): Promise<VideoEditFolderImportResult> {
  const owner = requireVideoEditInstance(projectId)
  const selected = await getPlatform().system.dialog.open({ directory: true, multiple: true })
  if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，请重新导入。')
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  return paths.length ? importVideoEditPathsAndFolders(projectId, paths, binId) : { itemIds: [], skipped: 0 }
}
