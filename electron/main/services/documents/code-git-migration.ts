import fsp from 'node:fs/promises'
import path from 'node:path'
import { codeFilePathSchema, type CodeFileReference } from '../../../../src/core/videoEdit/codeMaterial/sources'
import { componentSourceMetadata } from '../../../../src/core/videoEdit/codeMaterial/components'
import type { MigrateCodeStorageResult } from '../../../../src/core/videoEdit/codeMaterial/storageContract'
import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import type { DocumentReadResult } from '../../../../src/core/documents/types'
import { pathKey, isPathInside } from '../../../../src/core/storage/pathSyntax'
import { parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import { PersistenceError } from '../../../../src/core/persistence/migrations'
import { backupBeforePersistenceUpgrade } from '../persistence/file-upgrade'
import { moveDirectoryNoOverwrite } from '../fs/no-overwrite'
import { CodeGitRepository, codeDigest, type GitCodeWrite } from './code-git'
import { rewriteContentPaths } from './media-transfer'
import type { DocumentWorkspace } from './workspace'
import type { DocumentRepository } from './repository'
import type { MainLogger } from '../logging/main-logger'

interface LegacyVersion extends GitCodeWrite { originals: Array<{ path: string; relative: string; hash: string }> }
interface LegacyFolder { directory: string; versions: LegacyVersion[]; originals: Map<string, string> }
/** Find code references in nested document snapshots as well as ordinary video documents. */
function references(value: unknown): CodeFileReference[] {
  if (Array.isArray(value)) return value.flatMap(references)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const own = typeof record.location === 'string' && typeof record.hash === 'string' ? [{ location: record.location, hash: record.hash, path: String(record.path ?? record.name ?? '源码') }] : []
  return [...own, ...Object.values(record).flatMap(references)]
}

async function readLegacy(repository: CodeGitRepository, relative: string): Promise<string> {
  await repository.safePath(relative)
  const file = path.join(repository.dir, relative)
  const stat = await fsp.stat(file)
  if (!stat.isFile()) throw new Error('源码不是普通文件，请检查后重试。')
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fsp.readFile(file))
}

async function scanLegacy(repository: CodeGitRepository, documents: readonly DocumentReadResult[]): Promise<LegacyFolder[]> {
  const folders: LegacyFolder[] = []
  const entries = await fsp.readdir(repository.dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries) {
    if (!entry.isDirectory() || ['.git', '.henji'].includes(entry.name)) continue
    if (entry.name === '组件库') {
      for (const component of await fsp.readdir(path.join(repository.dir, entry.name), { withFileTypes: true })) {
        if (!component.isDirectory()) continue
        const directory = path.join(repository.dir, entry.name, component.name)
        const folder: LegacyFolder = { directory, versions: [], originals: new Map() }
        await repository.safePath(`${entry.name}/${component.name}/.probe`)
        for (const filename of await fsp.readdir(directory)) {
          const match = /^v([1-9]\d*)\.ts$/.exec(filename)
          if (!match) continue
          const relative = `${entry.name}/${component.name}/${filename}`
          const source = await readLegacy(repository, relative); const hash = codeDigest(source)
          if (await readLegacy(repository, `${relative}.sha256`) !== hash) throw new Error(`组件 ${component.name} 第 ${match[1]} 版校验失败，未改写文档或清理原文件。`)
          const metadata = componentSourceMetadata(source).metadata
          if (metadata.version !== Number(match[1])) throw new Error(`组件 ${component.name} 的版本号与文件名不一致，请恢复原版本。`)
          folder.versions.push({ kind: '组件', name: component.name, version: metadata.version, files: { 'main.ts': source }, originals: [{ path: path.join(directory, filename), relative: 'main.ts', hash }] })
          folder.originals.set(filename, hash); folder.originals.set(`${filename}.sha256`, codeDigest(hash))
          if (await fsp.stat(path.join(directory, `${filename}.withdrawn`)).catch(() => null)) folder.originals.set(`${filename}.withdrawn`, codeDigest(await readLegacy(repository, `${relative}.withdrawn`)))
        }
        if (folder.versions.length) folders.push(folder)
      }
      continue
    }
    const directory = path.join(repository.dir, entry.name)
    await repository.safePath(`${entry.name}/.probe`)
    const versionFolders = (await fsp.readdir(directory)).filter(name => /^v[1-9]\d*$/.test(name))
    if (!versionFolders.length) continue
    const folder: LegacyFolder = { directory, versions: [], originals: new Map() }
    const marker = await fsp.stat(path.join(directory, '.definition')).catch(() => null)
    const owner = marker ? await readLegacy(repository, `${entry.name}/.definition`) : findDefinitionId(documents, entry.name) ?? `legacy-${codeDigest(entry.name).slice(0, 32)}`
    if (marker) folder.originals.set('.definition', codeDigest(owner))
    for (const versionFolder of versionFolders) {
      const files: Record<string, string> = { '.definition': owner }
      const originals: LegacyVersion['originals'] = []
      const visit = async (relative: string): Promise<void> => {
        await repository.safePath(`${entry.name}/${versionFolder}${relative ? `/${relative}` : ''}/.probe`)
        for (const file of await fsp.readdir(path.join(directory, versionFolder, relative), { withFileTypes: true })) {
          const name = relative ? `${relative}/${file.name}` : file.name
          if (file.isSymbolicLink()) throw new Error('旧代码目录包含链接，请移除链接后迁移。')
          if (file.isDirectory()) { await visit(name); continue }
          codeFilePathSchema.parse(name)
          const source = await readLegacy(repository, `${entry.name}/${versionFolder}/${name}`)
          files[name] = source
          const hash = codeDigest(source)
          originals.push({ path: path.join(directory, versionFolder, name), relative: name, hash })
          folder.originals.set(`${versionFolder}/${name}`, hash)
        }
      }
      await visit('')
      if (originals.length) folder.versions.push({ kind: '素材', name: entry.name, version: Number(versionFolder.slice(1)), files, originals })
    }
    if (folder.versions.length) folders.push(folder)
  }
  for (const folder of folders) folder.versions.sort((a, b) => a.version - b.version)
  return folders
}

function findDefinitionId(documents: readonly DocumentReadResult[], folder: string): string | undefined {
  for (const document of documents) {
    const content = document.content as { codeMaterials?: Array<{ id: string; folder?: string }> }
    const definition = content.codeMaterials?.find(definition => definition.folder === folder)
    if (definition) return definition.id
  }
  return undefined
}

export async function migrateProjectCodeStorage(projectId: string, workspace: DocumentWorkspace, repository: DocumentRepository, kinds: Pick<DocumentKindRegistry, 'get'>, logger: MainLogger): Promise<MigrateCodeStorageResult> {
  const root = (await workspace.resolveContainer({ kind: 'project', projectId })).root
  const git = new CodeGitRepository(path.join(root, '代码'))
  return git.exclusive(async () => {
    logger.info('代码历史迁移开始', { event: 'documents.code.migrate.start', context: { projectId } })
    try {
      const documents: DocumentReadResult[] = []
      for (const row of workspace.catalog.listDocuments({ projectId, includeDrafts: true, includeMissing: true })) {
        if (kinds.get(row.kind)?.storage === 'json') documents.push(await repository.read({ id: row.id, path: row.path }))
      }
      const folders = await scanLegacy(git, documents)
      const originals = new Map(folders.flatMap(folder => folder.versions.flatMap(version => version.originals.map(file => [pathKey(workspace.style, file.path)!, file] as const))))
      // Validate all recorded hashes before the first commit or document write.
      for (const document of documents) for (const file of references(document.content)) {
        if (parseGitCodeLocation(file.location) || !isPathInside(workspace.style, git.dir, file.location)) continue
        const original = originals.get(pathKey(workspace.style, file.location)!)
        if (!original || original.hash !== file.hash) throw new Error(`${file.path} 的旧源码缺失或校验失败，原文档和文件未修改，请恢复备份后重试。`)
      }
      const mapping = new Map<string, string>()
      const priorTags = new Set((await git.versions()).map(version => version.tag))
      for (const document of documents) if (references(document.content).some(file => originals.has(pathKey(workspace.style, file.location)!))) {
        const kind = kinds.get(document.meta.kind)!
        await backupBeforePersistenceUpgrade(document.meta.path, { id: `document.${kind.id}`, name: kind.id, version: kind.version, migrations: kind.migrations }, kind.version, undefined, true)
      }
      const relocatedFiles = await git.migrateLayoutLocked()
      for (const folder of folders) for (const version of folder.versions) {
        await git.recoverImportLocked(version)
        const stored = await git.writeLocked(version)
        for (const file of version.originals) mapping.set(pathKey(workspace.style, file.path)!, stored.files.find(value => value.path === file.relative)!.location)
        if (version.kind === '组件' && folder.originals.has(`v${version.version}.ts.withdrawn`)) await git.withdrawLocked(stored.files[0].location, stored.files[0].hash)
      }
      await git.restoreLatestLocked()
      const transfers: MigrateCodeStorageResult['documents'] = []
      for (const document of documents) {
        const content = rewriteContentPaths(document.content, mapping, workspace.style)
        if (JSON.stringify(content) !== JSON.stringify(document.content)) await repository.save({ target: { id: document.meta.id, path: document.meta.path }, expectedRevision: document.meta.revision, content })
        const saved = await repository.read({ id: document.meta.id, path: document.meta.path })
        // All replacements must be durably visible before any old folder leaves the workspace.
        for (const file of references(saved.content)) {
          if (mapping.has(pathKey(workspace.style, file.location)!)) throw new Error('迁移引用尚未保存成功，旧文件已保留，请重试。')
          const parsed = parseGitCodeLocation(file.location)
          if (parsed && path.resolve(parsed.repository) === git.dir) await git.read(file.location, file.hash)
        }
        transfers.push({ meta: saved.meta, copiedFiles: 0, missingPaths: saved.missingPaths })
      }
      const retained = new Set<string>()
      let inspectable = true
      for (const row of workspace.catalog.listDocuments({ includeDrafts: true, includeMissing: true })) {
        if (kinds.get(row.kind)?.storage !== 'json') continue
        try { for (const file of references((await repository.read({ id: row.id, path: row.path })).content)) { const key = pathKey(workspace.style, file.location); if (key) retained.add(key) } }
        catch (error) {
          // 早于最低可读版本的文档任何当前版本都打不开，用不到这些源码；旧文件夹只是移进备份区，仍可找回。
          if (error instanceof PersistenceError && error.code === 'unsupported-version') { logger.info('跳过无法打开的旧格式文档', { event: 'documents.code.migrate.cleanup_skip_unreadable', context: { documentId: row.id, formatId: error.formatId, fromVersion: error.fromVersion } }); continue }
          inspectable = false; logger.warn('其他文档无法检查，保留旧代码文件夹', { event: 'documents.code.migrate.cleanup_deferred', error })
        }
      }
      let archivedFolders = 0
      for (const folder of folders) {
        if (!inspectable || folder.versions.some(version => version.originals.some(file => retained.has(pathKey(workspace.style, file.path)!)))) continue
        // A folder is moved atomically into the existing backup area: interruption cannot leave half-deleted versions.
        if (!await folderUnchanged(folder, git)) continue
        const fingerprint = codeDigest(JSON.stringify([...folder.originals].sort(([a], [b]) => a.localeCompare(b))))
        const backup = path.join(root, '.henji', 'backups', `code-git-${fingerprint}`, path.relative(git.dir, folder.directory))
        await new CodeGitRepository(root).safePath(path.relative(root, backup).split(path.sep).join('/'))
        await fsp.mkdir(path.dirname(backup), { recursive: true })
        await moveDirectoryNoOverwrite(folder.directory, backup)
        archivedFolders++
      }
      const result = { documents: transfers, relocatedFiles, importedVersions: (await git.versions()).filter(version => !priorTags.has(version.tag)).length, archivedFolders, retainedFolders: folders.length - archivedFolders }
      logger.info('代码历史迁移完成', { event: 'documents.code.migrate.completed', context: { projectId, importedVersions: result.importedVersions, archivedFolders, retainedFolders: result.retainedFolders } })
      return result
    } catch (error) {
      logger.warn('代码历史迁移未完成，旧文件或备份仍保留，可重新执行', { event: 'documents.code.migrate.failed', error, context: { projectId } })
      throw error
    }
  })
}

async function folderUnchanged(folder: LegacyFolder, git: CodeGitRepository): Promise<boolean> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { files.push('__link__'); continue }
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file)
      else files.push(path.relative(folder.directory, file).split(path.sep).join('/'))
    }
  }
  await visit(folder.directory)
  if (files.length !== folder.originals.size || files.some(file => !folder.originals.has(file))) return false
  for (const file of files) if (codeDigest(await readLegacy(git, path.relative(git.dir, path.join(folder.directory, file)).split(path.sep).join('/'))) !== folder.originals.get(file)) return false
  return true
}
