import type { Dirent, Stats } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { buildDocumentEnvelope, carryDocumentEnvelopeForward } from '../../../../src/core/documents/envelope'
import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { sameEntryName } from '../../../../src/core/documents/naming'
import { INTERNAL_FOLDER_NAME, ProjectManifestError, type ProjectManifest } from '../../../../src/core/documents/projectManifest'
import type { DocumentIndexScanReport } from '../../../../src/core/documents/types'
import { PersistenceError } from '../../../../src/core/persistence/migrations'
import { isPathInside, pathKey, samePath } from '../../../../src/core/storage/pathSyntax'
import { writeJsonFile } from '../fs/json-file'
import { isUnavailableTraversalEntry, resolveLinkedPath } from '../fs/traversal'
import type { MainLogger } from '../logging/main-logger'
import type { IndexedDocument } from './catalog'
import { indexedFromFile, loadDocumentFile, statDocumentLocation, summarizeFile, type LoadedDocumentFile } from './document-file'
import { DocumentFormatError, DocumentNotFoundError, DocumentUnsupportedError, errorCode } from './errors'
import type { PackageAdapterRegistry } from './package-adapters'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'

/*
 * 索引只是作品文件的投影，可根据实际位置和内容重建；扫描范围：
 * - 作品目录“项目”文件夹下的每个子文件夹（项目；没有项目说明的补写一份）与登记过的外部项目；
 *   项目里递归扫描（含用户自建子文件夹），跳过顶层的“生成结果 / 素材 / .henji”与嵌套的其他项目；
 * - 作品目录下各类型的独立存放文件夹（递归，跳过其中的项目文件夹）；
 * - 登记过的外部文件夹（另存位置，只看当前层）。
 *
 * 按修改时间 + 大小增量：没变的文件不重新读取。拷贝出来的副本与原件 ID 重复时给新发现的副本
 * 换新 ID 并写回它的文件头（已在索引里、位置没变的那份保留 ID；都没在索引里时创建时间早的保留）；
 * 原位置消失而新位置出现同 ID 视为移动；找不到的标为缺失；不在当前扫描范围里的旧记录删除。
 */

export interface DocumentIndexScannerOptions {
  workspace: DocumentWorkspace
  kinds: DocumentKindRegistry
  adapters: PackageAdapterRegistry
  logger: MainLogger
}

interface ScanCandidate {
  path: string
  physicalPath: string
  container: ResolvedContainer
  mtimeMs: number
  size: number
  birthtimeMs: number
}

interface ProjectCandidate {
  root: string
  birthtimeMs: number
}

type MutableReport = Omit<DocumentIndexScanReport, 'durationMs'>


/** 内容错误可以跳过；备份/磁盘错误仍须中止本轮，保留原索引。 */
function isUnreadableFileContent(error: unknown): boolean {
  let cause = error
  const seen = new Set<unknown>()
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause)
    if (/^E[A-Z0-9]+$/.test(errorCode(cause) ?? '') || (cause instanceof PersistenceError && cause.code === 'backup-failed')) return false
    cause = cause.cause
  }
  return error instanceof DocumentFormatError || error instanceof ProjectManifestError
    || error instanceof SyntaxError || (error instanceof PersistenceError && error.code !== 'backup-failed')
}

function isMissing(error: unknown): boolean {
  return error instanceof DocumentNotFoundError || errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR'
}

async function statIfPresent(target: string): Promise<Stats | null> {
  try { return await fsp.stat(target) }
  catch (error) { if (isMissing(error)) return null; throw error }
}

function emptyReport(startedAt: number): MutableReport {
  return { startedAt, projects: 0, documents: 0, readDocuments: 0, reassignedIds: 0, moved: 0, missing: 0, invalid: 0 }
}

export class DocumentIndexScanner {
  private queue: Promise<unknown> = Promise.resolve()
  private pending: Promise<DocumentIndexScanReport> | null = null
  private mutations: Array<() => void> = []
  private scannedProjectRoots: string[] = []
  private rebuilding = false
  private readonly invalidPaths = new Set<string>()
  private readonly skippedPaths = new Set<string>()
  private documentAliases = new Map<string, string>()

  constructor(private readonly options: DocumentIndexScannerOptions) {}

  private get workspace(): DocumentWorkspace {
    return this.options.workspace
  }

  findIndexedDocument(filePath: string): IndexedDocument | null {
    const absolute = path.resolve(filePath)
    const key = pathKey(this.workspace.style, absolute) ?? absolute
    return this.workspace.catalog.getDocumentByPath(this.documentAliases.get(key) ?? absolute)
  }

  /** 全量增量扫描。扫描进行中再次调用会在本轮结束后再扫一轮，期间的调用共用这一轮的结果。 */
  refresh(): Promise<DocumentIndexScanReport> {
    if (this.pending) return this.pending
    const run = this.queue.then(() => {
      this.pending = null
      return this.scanOnce()
    })
    this.pending = run
    this.queue = run.catch(() => undefined)
    return run
  }

  /** 清掉可重建的索引行（保留外部位置）后完整扫描。 */
  rebuild(): Promise<DocumentIndexScanReport> {
    const run = this.queue.then(() => {
      this.options.logger.info('开始重建作品索引，读取完成前保留原索引', { event: 'documents.index.rebuild.start' })
      return this.scanOnce(true)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async scanOnce(rebuilding = false): Promise<DocumentIndexScanReport> {
    const startedAt = Date.now()
    const report = emptyReport(startedAt)
    const logger = this.options.logger
    this.mutations = []
    this.scannedProjectRoots = []
    this.rebuilding = rebuilding
    this.invalidPaths.clear()
    this.skippedPaths.clear()
    let publishingIndex = false
    logger.info('开始扫描作品索引', { event: 'documents.index.scan.start' })
    try {
      const projects = await this.scanProjects(report)
      await this.scanDocuments(projects, report)
      await this.sweepProjects(projects, report)
      // I/O 阶段完全成功才改变索引，权限/磁盘故障不会把原有记录标为缺失。
      publishingIndex = true
      if (this.rebuilding) this.workspace.catalog.clearRebuildableIndex()
      for (const apply of this.mutations) apply()
      const result = { ...report, durationMs: Date.now() - startedAt }
      logger.info('作品索引扫描完成', { event: 'documents.index.scan.completed', context: result })
      return result
    } catch (error) {
      logger.error('作品索引扫描失败', { event: 'documents.index.scan.failed', context: { ...report }, error })
      throw new Error(publishingIndex
        ? '作品索引更新未完成，请检查磁盘空间后重试扫描。作品文件已保留。'
        : '作品索引扫描未完成，原有索引已保留。请检查作品目录及外部文件夹的访问权限、磁盘连接后重试。', { cause: error })
    } finally { this.mutations = []; this.scannedProjectRoots = []; this.rebuilding = false }
  }

  // ==================== 项目 ====================

  private async listProjectCandidates(): Promise<ProjectCandidate[]> {
    const layout = this.workspace.layout()
    const roots: string[] = []
    for (const entry of await this.readDirectory(layout.projectsDir)) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) roots.push(path.join(layout.projectsDir, entry.name))
    }
    for (const location of this.workspace.catalog.listExternalLocations()) {
      if (location.kind === 'project' && !roots.some((root) => samePath(this.workspace.style, root, location.path))) roots.push(location.path)
    }
    const candidates: ProjectCandidate[] = []
    for (const root of roots) {
      const stat = await statIfPresent(root)
      if (stat?.isDirectory()) candidates.push({ root, birthtimeMs: stat.birthtimeMs })
    }
    // 已在索引里、位置没变的项目先认领 ID，拷贝出来的副本后处理；其余按创建时间先后。
    const indexed = new Set(candidates.filter((candidate) => this.workspace.catalog.getProjectByPath(candidate.root)).map((candidate) => candidate.root))
    return candidates.sort((left, right) => Number(indexed.has(right.root)) - Number(indexed.has(left.root)) || left.birthtimeMs - right.birthtimeMs)
  }

  /** 扫描项目，返回本轮认领的项目（ID → 容器）。 */
  private async scanProjects(report: MutableReport): Promise<Map<string, ResolvedContainer>> {
    const claimed = new Map<string, ResolvedContainer>()
    const catalog = this.workspace.catalog
    for (const candidate of await this.listProjectCandidates()) {
      let manifest: ProjectManifest
      try {
        manifest = (await this.workspace.ensureManifest(candidate.root)).manifest
      } catch (error) {
        if (!isUnreadableFileContent(error)) throw error
        this.recordInvalid(candidate.root, error, report, true)
        continue
      }
      if (await this.isDuplicateProject(manifest.id, candidate.root, claimed, report)) {
        const previousId = manifest.id
        manifest = { ...manifest, id: this.workspace.randomId() }
        await this.workspace.writeManifest(candidate.root, manifest)
        report.reassignedIds += 1
        this.options.logger.info('拷贝出来的项目已换新 ID', {
          event: 'documents.index.project_id_reassigned',
          context: { root: candidate.root, previousId, projectId: manifest.id },
        })
      }
      const project = await this.workspace.describeProject(candidate.root, manifest)
      this.mutations.push(() => catalog.upsertProject(project))
      this.scannedProjectRoots.push(project.path)
      claimed.set(project.id, this.workspace.containerOfProject(candidate.root, manifest))
      report.projects += 1
    }
    return claimed
  }

  private async isDuplicateProject(id: string, root: string, claimed: ReadonlyMap<string, ResolvedContainer>, report: MutableReport): Promise<boolean> {
    if (claimed.has(id)) return true
    const existing = this.workspace.catalog.getProject(id)
    if (!existing || samePath(this.workspace.style, existing.path, root)) return false
    try {
      const other = await this.workspace.readManifest(existing.path)
      return other?.id === id
    } catch (error) {
      if (!isUnreadableFileContent(error) && !isMissing(error)) throw error
      this.recordInvalid(existing.path, error, report, true)
      return false
    }
  }

  /** 本轮没扫到的项目：文件夹不在了标缺失，不在扫描范围的旧记录删除。 */
  private async sweepProjects(claimed: ReadonlyMap<string, ResolvedContainer>, report: MutableReport): Promise<void> {
    const catalog = this.workspace.catalog
    const layout = this.workspace.layout()
    const locations = catalog.listExternalLocations().filter((location) => location.kind === 'project')
    for (const project of catalog.listProjects()) {
      if (claimed.has(project.id)) continue
      const stat = await statIfPresent(project.path)
      if (stat && !stat.isDirectory()) throw new Error(`项目位置不是文件夹：${project.path}`)
      const exists = stat !== null
      const inScope = samePath(this.workspace.style, path.dirname(project.path), layout.projectsDir)
        || locations.some((location) => samePath(this.workspace.style, location.path, project.path))
      if (!exists) {
        if (!project.missing) {
          this.mutations.push(() => catalog.upsertProject({ ...project, missing: true }))
          report.missing += 1
        }
      } else if (!inScope) {
        this.mutations.push(() => catalog.removeProject(project.id))
      }
    }
  }

  // ==================== 文档 ====================

  private async scanDocuments(projects: ReadonlyMap<string, ResolvedContainer>, report: MutableReport): Promise<void> {
    const candidates: ScanCandidate[] = []
    for (const container of projects.values()) {
      const manifest = container.manifest as ProjectManifest
      const skipTop = [manifest.folders.generated, manifest.folders.materials, INTERNAL_FOLDER_NAME]
      await this.collect(container.root, container, candidates, { skipTop }, report)
      // 素材文件夹整体不扫（可能很大），只看素材类文档自己的子文件夹（如 素材/录屏/ 里的 .hjweb）。
      for (const name of new Set(this.options.kinds.list().flatMap((kind) => kind.projectMaterialsFolderNames ? [kind.projectMaterialsFolderNames[container.locale]] : []))) {
        await this.collect(path.join(container.materialsDir, name), container, candidates, { skipTop: [] }, report)
      }
    }
    for (const folder of this.standaloneFolders()) await this.collect(folder, await this.workspace.containerForFolder(folder), candidates, { skipTop: [] }, report)
    for (const location of this.workspace.catalog.listExternalLocations()) {
      if (location.kind === 'folder') await this.collect(location.path, await this.workspace.containerForFolder(location.path), candidates, { skipTop: [], recursive: false }, report)
    }

    const catalog = this.workspace.catalog
    const claimed = new Set<string>()
    const changed: ScanCandidate[] = []
    const physicalFiles = new Map<string, ScanCandidate>()
    for (const candidate of candidates) {
      const key = pathKey(this.workspace.style, candidate.physicalPath) ?? candidate.physicalPath
      // 目录别名与交叠扫描根指向同一文件，优先保留已经建立引用的索引位置。
      if (!physicalFiles.has(key) || catalog.getDocumentByPath(candidate.path)) physicalFiles.set(key, candidate)
    }
    const aliases = new Map<string, string>()
    for (const candidate of candidates) {
      const physicalKey = pathKey(this.workspace.style, candidate.physicalPath) ?? candidate.physicalPath
      const indexedPath = physicalFiles.get(physicalKey)!.path
      if (!samePath(this.workspace.style, candidate.path, indexedPath)) aliases.set(pathKey(this.workspace.style, candidate.path) ?? candidate.path, indexedPath)
    }
    this.mutations.push(() => { this.documentAliases = aliases })
    // 第一轮：位置与修改时间、大小都没变的文件直接认领原 ID，不重新读取。
    // 项目可以包含作品目录或其他登记位置，同一物理文件只认领一次。
    for (const candidate of physicalFiles.values()) {
      const row = catalog.getDocumentByPath(candidate.path)
      const projectId = candidate.container.ref.kind === 'project' ? candidate.container.ref.projectId : null
      if (!this.rebuilding && row && !row.missing && !claimed.has(row.id) && row.fileModifiedAt === candidate.mtimeMs
        && row.fileSize === candidate.size && row.projectId === projectId) {
        claimed.add(row.id)
        report.documents += 1
      } else {
        changed.push(candidate)
      }
    }
    // 第二轮：新增或修改过的文件读取文件头；位置已在索引里的先处理，其余按创建时间先后（原件先于副本）。
    const indexedAtPath = new Set(changed.filter((candidate) => catalog.getDocumentByPath(candidate.path)))
    changed.sort((left, right) => Number(indexedAtPath.has(right)) - Number(indexedAtPath.has(left)) || left.birthtimeMs - right.birthtimeMs)
    for (const candidate of changed) {
      const row = await this.indexCandidate(candidate, claimed, report)
      if (row) {
        claimed.add(row.id)
        report.documents += 1
      }
    }
    await this.sweepDocuments(claimed, report)
  }

  private standaloneFolders(): string[] {
    const layout = this.workspace.layout()
    return this.options.kinds.list().flatMap((kind) => kind.standaloneFolderNames ? [path.join(layout.root, kind.standaloneFolderNames[layout.locale])] : [])
  }

  private async readDirectory(directory: string): Promise<Dirent[]> {
    try {
      return await fsp.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  /** 收集文件夹里的文档文件；真实路径检查回环，跳过点开头的文件夹与嵌套的其他项目。 */
  private async collect(
    directory: string,
    container: ResolvedContainer,
    candidates: ScanCandidate[],
    options: { skipTop: readonly string[]; recursive?: boolean },
    report: MutableReport,
    level = 0,
    ancestors = new Set<string>(),
    physicalDirectory?: string,
  ): Promise<void> {
    let real: string
    try { real = physicalDirectory ?? await resolveLinkedPath(directory) }
    catch (error) {
      if (isMissing(error)) return
      if (!isUnavailableTraversalEntry(error)) throw error
      this.skipEntry(directory, error)
      return
    }
    const key = pathKey(this.workspace.style, real) ?? real
    if (ancestors.has(key)) return
    ancestors.add(key)
    for (const entry of await this.readDirectory(directory)) {
      const entryPath = path.join(directory, entry.name)
      const kind = this.options.kinds.forFileName(entry.name)
      if (options.recursive === false && !kind) continue
      try {
        let physicalPath = path.join(real, entry.name)
        if (entry.isSymbolicLink()) {
          try { physicalPath = await fsp.realpath(entryPath) }
          catch (error) {
            if (!isMissing(error) && !isUnavailableTraversalEntry(error)) throw error
            this.skipEntry(entryPath, error)
            continue
          }
        }
        const info = entry.isSymbolicLink() ? await statIfPresent(entryPath) : entry
        if (!info) continue
        if (info.isDirectory() && kind?.storage === 'folder') {
          // 文件夹类型（`.hjweb`）本身就是一份文档：认领它，不再往里找。
          const stat = await statDocumentLocation(kind, entryPath, this.options.adapters).catch((error: unknown) => {
            if (isMissing(error) || error instanceof DocumentUnsupportedError) return null
            if (!isUnreadableFileContent(error)) throw error
            this.recordInvalid(entryPath, error, report)
            return null
          })
          if (stat) candidates.push({ path: entryPath, physicalPath, container, mtimeMs: stat.mtimeMs, size: stat.size, birthtimeMs: stat.birthtimeMs })
          continue
        }
        if (info.isDirectory()) {
          if (options.recursive === false) continue
          if (entry.name.startsWith('.')) continue
          if (level === 0 && options.skipTop.some((name) => sameEntryName(name, entry.name))) continue
          try { if (await this.workspace.readManifest(entryPath)) continue }
          catch (error) {
            if (!isUnreadableFileContent(error)) throw error
            this.recordInvalid(entryPath, error, report, true)
            continue
          }
          await this.collect(entryPath, container, candidates, options, report, level + 1, ancestors, physicalPath)
          continue
        }
        if (!info.isFile() || !kind || kind.storage === 'folder') continue
        const stat = await statIfPresent(entryPath)
        if (!stat?.isFile()) continue
        candidates.push({ path: entryPath, physicalPath, container, mtimeMs: stat.mtimeMs, size: stat.size, birthtimeMs: stat.birthtimeMs })
      } catch (error) {
        if (isMissing(error)) continue
        if (!isUnavailableTraversalEntry(error)) throw error
        this.skipEntry(entryPath, error)
      }
    }
    ancestors.delete(key)
  }

  private skipEntry(target: string, error: unknown): void {
    // 已消失的路径仍需参加缺失清点，只有访问受阻才保留原索引。
    if (isUnavailableTraversalEntry(error)) this.skippedPaths.add(target)
    this.options.logger.warn('跳过无法访问的扫描项', { event: 'documents.index.entry_skipped', context: { path: target }, error })
  }

  private async indexCandidate(candidate: ScanCandidate, claimed: ReadonlySet<string>, report: MutableReport): Promise<IndexedDocument | null> {
    const catalog = this.workspace.catalog
    let file: LoadedDocumentFile
    try {
      file = await loadDocumentFile(candidate.path, { kinds: this.options.kinds, adapters: this.options.adapters })
    } catch (error) {
      if (error instanceof DocumentUnsupportedError) return null
      if (isUnavailableTraversalEntry(error)) { this.skipEntry(candidate.path, error); return null }
      if (!isUnreadableFileContent(error) && !isMissing(error)) throw error
      this.recordInvalid(candidate.path, error, report)
      return null
    }
    report.readDocuments += 1
    const id = file.header.id
    const existing = catalog.getDocument(id)
    if (claimed.has(id) || await this.otherCopyStillThere(existing, candidate.path, id, report)) {
      file = await this.reassignId(file, candidate.container, report)
    } else if (existing && !samePath(this.workspace.style, existing.path, candidate.path)) {
      report.moved += 1
      this.options.logger.info('识别到文档移动', { event: 'documents.index.document_moved', context: { documentId: id, from: existing.path, to: candidate.path } })
    }
    const row = indexedFromFile(file, candidate.container, summarizeFile(file, candidate.container, this.workspace))
    this.mutations.push(() => catalog.upsertDocument(row))
    return row
  }

  private async otherCopyStillThere(existing: IndexedDocument | null, candidatePath: string, id: string, report: MutableReport): Promise<boolean> {
    if (!existing || samePath(this.workspace.style, existing.path, candidatePath)) return false
    try {
      if (samePath(this.workspace.style, await resolveLinkedPath(existing.path), await resolveLinkedPath(candidatePath))) return false
      const other = await loadDocumentFile(existing.path, { kinds: this.options.kinds, adapters: this.options.adapters })
      return other.header.id === id
    } catch (error) {
      if (isMissing(error) || error instanceof DocumentUnsupportedError) return false
      if (isUnreadableFileContent(error)) {
        this.recordInvalid(existing.path, error, report)
        return false
      }
      throw error
    }
  }

  private recordInvalid(target: string, error: unknown, report: MutableReport, project = false): void {
    const key = pathKey(this.workspace.style, target) ?? target
    if (this.invalidPaths.has(key)) return
    this.invalidPaths.add(key)
    report.invalid += 1
    this.options.logger.warn(project ? '项目说明无法读取，跳过这个项目' : '跳过无法识别的文档文件', {
      event: project ? 'documents.index.project_invalid' : 'documents.index.document_invalid',
      context: { path: target }, error,
    })
  }

  /** 给新发现的副本换新 ID 并写回它的文件头；所在项目的主剪辑指向旧 ID 时一并改写。 */
  private async reassignId(file: LoadedDocumentFile, container: ResolvedContainer, report: MutableReport): Promise<LoadedDocumentFile> {
    const previousId = file.header.id
    const id = this.workspace.randomId()
    if (file.envelope) {
      const envelope = carryDocumentEnvelopeForward(file.envelope, buildDocumentEnvelope({ ...file.envelope, id, draft: file.envelope.draft === true }))
      await writeJsonFile(file.path, envelope)
    } else {
      const adapter = this.options.adapters.get(file.kind.id)
      if (!adapter) throw new DocumentUnsupportedError('这种文档的读写尚未接入。')
      await adapter.writeHeader(file.path, { id })
    }
    const manifest = container.manifest
    if (manifest?.mainVideoEditId === previousId) {
      const updated = { ...manifest, mainVideoEditId: id }
      await this.workspace.writeManifest(container.root, updated)
      container.manifest = updated
    }
    report.reassignedIds += 1
    this.options.logger.info('拷贝出来的文档已换新 ID', {
      event: 'documents.index.document_id_reassigned',
      context: { path: file.path, previousId, documentId: id },
    })
    return await loadDocumentFile(file.path, { kinds: this.options.kinds, adapters: this.options.adapters }, id)
  }

  /** 本轮没扫到的文档：文件不在了标缺失，不在扫描范围的旧记录删除，其余（扫描期间刚写入的）保留。 */
  private async sweepDocuments(claimed: ReadonlySet<string>, report: MutableReport): Promise<void> {
    const catalog = this.workspace.catalog
    const scopes = this.documentScopes()
    for (const row of catalog.listDocuments()) {
      if (claimed.has(row.id)) continue
      if ([...this.skippedPaths].some(target => isPathInside(this.workspace.style, target, row.path))) {
        if (this.rebuilding) this.mutations.push(() => catalog.upsertDocument(row))
        continue
      }
      const stat = await statIfPresent(row.path)
      const folder = this.options.kinds.get(row.kind)?.storage === 'folder'
      if (stat && (folder ? !stat.isDirectory() : !stat.isFile())) throw new Error(`文档位置不是${folder ? '文件夹' : '文件'}：${row.path}`)
      const exists = stat !== null
      if (!exists) {
        if (!row.missing) {
          this.mutations.push(() => catalog.upsertDocument({ ...row, missing: true }))
          report.missing += 1
        }
      } else if (!scopes.some((scope) => scope(row.path))) {
        this.mutations.push(() => catalog.removeDocument(row.id))
      }
    }
  }

  private documentScopes(): Array<(target: string) => boolean> {
    const style = this.workspace.style
    const catalog = this.workspace.catalog
    const projectRoots = [...this.scannedProjectRoots, ...catalog.listProjects().map((project) => project.path)]
    const folders = catalog.listExternalLocations().filter((location) => location.kind === 'folder').map((location) => location.path)
    return [
      ...projectRoots.map((root) => (target: string) => isPathInside(style, root, target)),
      ...this.standaloneFolders().map((folder) => (target: string) => isPathInside(style, folder, target)),
      ...folders.map((folder) => (target: string) => samePath(style, folder, path.dirname(target))),
    ]
  }
}

