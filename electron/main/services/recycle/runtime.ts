import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type { RecycledItem } from '../../../../src/core/localRecords/recycle'
import { getDb } from '../db'
import { getProgramDataDir, getUserRootDir } from '../appPaths'
import { createMainLogger } from '../logging/main-logger'
import { RecycleStore, recycledFile, type RecycledLink } from './store'
import { copyRecycledFile } from './file-copy'
import type { AudioCapturePlacement } from '../../../../src/core/audioCapture/contracts'

const logger = createMainLogger('main.recycle')
export const recycleBackupRoot = (): string => path.join(getProgramDataDir(), 'recent-deleted')
const store = (): RecycleStore => new RecycleStore(getDb())
let tail = Promise.resolve()
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = tail.then(action)
  tail = result.then(() => undefined, () => undefined)
  return result
}

export async function* readRecycledJsonContents(onUnreadable?: (file: string) => void): AsyncGenerator<unknown> {
  const pending = store().files().map(item => item.payload)
  const visited = new Set<string>()
  while (pending.length) {
    const file = pending.pop()!
    try {
      const stat = await fs.lstat(file)
      // 链接外的内容不属于副本；无法判断引用时由调用方保守保留资源。
      if (stat.isSymbolicLink()) {
        logger.warn('回收副本包含链接，相关资源保留', { event: 'recycle.references.link', context: { file } })
        onUnreadable?.(file); continue
      }
      const real = await fs.realpath(file)
      if (visited.has(real)) continue
      visited.add(real)
      if (stat.isDirectory()) for (const entry of await fs.readdir(file)) pending.push(path.join(file, entry))
      else if (path.extname(file).toLowerCase() === '.json') yield JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as unknown
    } catch (error) {
      logger.warn('回收副本无法读取，相关资源保留', { event: 'recycle.references.unreadable', context: { file }, error })
      onUnreadable?.(file)
    }
  }
}

const warnLink = (file: string, error: unknown): void => logger.warn('链接以目标声明保留', { event: 'recycle.link.preserved', context: { file }, error })
/** 文件和目录共用字节备份；系统回收站负责原件，应用入口负责原位置恢复。 */
async function preserveFile(target: string, name = path.basename(target), source = target, capturePlacement?: AudioCapturePlacement, onPreserved?: () => void): Promise<void> {
  try { await fs.lstat(source) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const id = randomUUID()
  const backup = path.join(recycleBackupRoot(), `${id}-${path.basename(target)}`)
  logger.info('保留内容副本', { event: 'recycle.preserve.start', context: { id, name } })
  try {
    await fs.mkdir(path.dirname(backup), { recursive: true })
    const links = await copyRecycledFile(source, backup, warnLink)
    if (links.some(link => !link.relativePath)) await fs.mkdir(backup)
    store().snapshot('file', target, name, JSON.stringify({ backup, ...(links.length ? { links } : {}), ...(capturePlacement ? { capturePlacement } : {}) }), id)
    onPreserved?.()
    logger.info('内容副本已保留', { event: 'recycle.preserve.completed', context: { id, name } })
  } catch (error) { logger.error('保留内容副本失败', { event: 'recycle.preserve.failed', context: { id, name }, error }); throw error }
}
export const preserveUserFile = (target: string, name?: string, source?: string): Promise<void> => serial(() => preserveFile(target, name, source))

export const trashUserFile = (target: string, name?: string, capturePlacement?: AudioCapturePlacement, onPreserved?: () => void): Promise<void> => serial(async () => {
  await preserveFile(target, name, target, capturePlacement, onPreserved)
  await shell.trashItem(target)
})

export interface RecycleIntegrations {
  listDeletedWebRecordings: () => Promise<RecycledItem[]>
  restoreWebRecording: (id: string) => Promise<void>
  restoreDocumentLocation: (target: string) => Promise<void>
}

export const listRecycledItems = (integrations: Pick<RecycleIntegrations, 'listDeletedWebRecordings'>): Promise<RecycledItem[]> => serial(async () => {
  await purge()
  return [...store().list(), ...await integrations.listDeletedWebRecordings()].sort((a, b) => b.deletedAt - a.deletedAt)
})

async function purge(): Promise<void> {
  const records = store()
  for (const item of records.expired()) {
    if (item.kind === 'file') await fs.rm(recycledFile(item).backup, { recursive: true, force: true })
    records.forget(item.id)
  }
  records.purgeRows()
}
export const purgeRecycledItems = (): Promise<void> => serial(purge)

async function prepareAssetRestore(id: string): Promise<void> {
  if (!id.startsWith('assets:')) return
  const db = getDb(), rowId = id.slice('assets:'.length)
  const row = db.prepare('SELECT file_path FROM assets WHERE id=? AND deleted_at IS NOT NULL').get(rowId) as { file_path: string } | undefined
  if (!row || !db.prepare('SELECT 1 FROM assets WHERE file_path=? AND deleted_at IS NULL').get(row.file_path)) return
  const { databaseLocations } = await import('../db-locations')
  const source = databaseLocations.use(scope => scope.decodePath(row.file_path))
  const extension = path.extname(source)
  const target = `${source.slice(0, source.length - extension.length)}-恢复-${randomUUID()}${extension}`
  await copyRecycledFile(source, target, warnLink)
  const storedPath = databaseLocations.use(scope => scope.encodePath(target))
  db.prepare('UPDATE assets SET file_path=? WHERE id=? AND deleted_at IS NOT NULL').run(storedPath, rowId)
}

export const restoreRecycledItem = (id: string, integrations: Pick<RecycleIntegrations, 'restoreWebRecording' | 'restoreDocumentLocation'>): Promise<void> => serial(async () => {
  logger.info('恢复已删除内容', { event: 'recycle.restore.start', context: { id } })
  try {
    const records = store()
    if (id.startsWith('web-recording:')) {
      await integrations.restoreWebRecording(id.slice('web-recording:'.length))
      logger.info('内容已恢复', { event: 'recycle.restore.completed', context: { id } })
      return
    }
    const item = records.get(id)
    if (!item) await prepareAssetRestore(id)
    if (item || !records.restoreRow(id)) {
      if (!item) throw new Error('这项内容已恢复或已过保留期。')
      if (item.kind === 'file' && path.resolve(item.target) === path.resolve(getProgramDataDir(), 'llm-config.json')) {
        const { llmProviderSettingsService } = await import('../llm/provider-settings')
        const raw = JSON.parse(await fs.readFile(recycledFile(item).backup, 'utf8'))
        const saved = (raw.content ?? raw) as import('@henjicc/ai-sdk').LlmConfigState
        let current = await llmProviderSettingsService.readConfig()
        for (const provider of saved.providers) if (!current?.providers.some(value => value.providerId === provider.providerId)) {
          await llmProviderSettingsService.restoreDeleted({ provider, models: saved.models.filter(value => value.providerId === provider.providerId) })
          current = await llmProviderSettingsService.readConfig()
        }
        await llmProviderSettingsService.restoreDeleted({ models: saved.models.filter(model => !current?.models.some(value => value.providerId === model.providerId && value.modelId === model.modelId)) })
      } else if (item.kind === 'file') {
        // 覆盖现有文件前也留一份，恢复旧版本不会吞掉后来保存的内容。
        await preserveFile(item.target)
        const staging = `${item.target}.restore-${randomUUID()}`
        await fs.mkdir(path.dirname(item.target), { recursive: true })
        const saved = recycledFile(item)
        const deferred = [...saved.links ?? [], ...await copyRecycledFile(saved.backup, staging, warnLink)]
        for (const link of deferred) {
          const destination = path.join(staging, link.relativePath)
          if (!link.relativePath) await fs.rm(destination, { recursive: true, force: true })
          try { await fs.symlink(link.target, destination, link.directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file') }
          catch (error) {
            warnLink(destination, error)
            records.snapshot('link', path.join(item.target, link.relativePath), path.basename(link.target), JSON.stringify(link))
            if (!link.relativePath) await fs.mkdir(staging)
          }
        }
        if (await fs.access(item.target).then(() => true, () => false)) await shell.trashItem(item.target)
        await fs.rename(staging, item.target)
        if (path.resolve(path.dirname(item.target)) === path.resolve(getUserRootDir(), '录音')) {
          const { AudioCaptureFiles } = await import('../audio-capture/files')
          const { getSettingsStore } = await import('../settings/store')
          new AudioCaptureFiles(getUserRootDir, getSettingsStore, (file, placement) => trashUserFile(file, undefined, placement)).restore(item.target, saved.capturePlacement)
        }
        await integrations.restoreDocumentLocation(item.target).catch(error => logger.warn('内容已恢复，列表刷新待重试', { event: 'recycle.index_refresh.failed', context: { id }, error }))
      } else if (item.kind === 'record') records.restoreRecord(item)
      else if (item.kind === 'rows') records.restoreRows(item)
      else if (item.kind === 'member') {
        if (item.target === 'sound-library-folder') {
          const { restoreSoundLibraryFolder } = await import('../sound-library/registry')
          await restoreSoundLibraryFolder(JSON.parse(item.payload))
        } else if (item.target === 'llm-provider' || item.target === 'llm-model') {
          const { llmProviderSettingsService } = await import('../llm/provider-settings')
          await llmProviderSettingsService.restoreDeleted(JSON.parse(item.payload))
        } else throw new Error('未知的回收记录类型。')
        records.forget(id)
      } else if (item.kind === 'link') {
        const link = JSON.parse(item.payload) as RecycledLink
        await fs.symlink(link.target, item.target, link.directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file')
        records.forget(id)
      }
      else if (item.target === 'sound_library.folders') {
        const { readSoundLibraryFolders, writeSoundLibraryFolders, SOUND_LIBRARY_FOLDERS_CONTRACT } = await import('../sound-library/registry')
        const { parseVersionedPersistenceJson } = await import('../../../../src/core/persistence/versionedJson')
        const current = await readSoundLibraryFolders()
        const saved = parseVersionedPersistenceJson(JSON.parse((JSON.parse(item.payload) as { value: string }).value), SOUND_LIBRARY_FOLDERS_CONTRACT) as import('../../../../src/core/soundLibrary/soundLibraryFolders').SoundLibraryFolderRecord[]
        await writeSoundLibraryFolders([...current, ...saved.filter(value => !current.some(folder => folder.id === value.id))])
        records.forget(id)
      } else {
        const current = getDb().prepare('SELECT value,type FROM settings WHERE key = ?').get(item.target) as { value: string; type: string } | undefined
        getDb().transaction(() => {
          if (current) records.snapshot('setting', item.target, item.name, JSON.stringify(current))
          const value = JSON.parse(item.payload) as { value: string; type: string }
          getDb().prepare('INSERT INTO settings (key,value,type) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,type=excluded.type').run(item.target, value.value, value.type)
          records.forget(id)
        })()
      }
      if (item.kind === 'file') {
        records.forget(id)
        await fs.rm(recycledFile(item).backup, { recursive: true, force: true }).catch(error => logger.warn('恢复后的副本待清理', { event: 'recycle.cleanup.failed', context: { id }, error }))
      }
    }
    logger.info('内容已恢复', { event: 'recycle.restore.completed', context: { id } })
  } catch (error) { logger.error('恢复内容失败', { event: 'recycle.restore.failed', context: { id }, error }); throw error }
})
