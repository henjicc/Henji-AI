import type { Dirent } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { buildDocumentEnvelope, serializeDocumentEnvelope } from '../../../../src/core/documents/envelope'
import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { sameEntryName } from '../../../../src/core/documents/naming'
import { INTERNAL_FOLDER_NAME, ProjectManifestError, type ProjectManifest } from '../../../../src/core/documents/projectManifest'
import type { DocumentIndexScanReport } from '../../../../src/core/documents/types'
import { isPathInside, pathKey, samePath } from '../../../../src/core/storage/pathSyntax'
import { writeBufferAtomically } from '../fs/atomic-file'
import type { MainLogger } from '../logging/main-logger'
import type { IndexedDocument } from './catalog'
import { indexedFromFile, loadDocumentFile, summarizeFile, type LoadedDocumentFile } from './document-file'
import { DocumentFormatError, DocumentUnsupportedError } from './errors'
import type { PackageAdapterRegistry } from './package-adapters'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'

/*
 * 作品索引扫描（实施方案 2.7）。索引只是文件的投影，可以随时删掉重建；扫描范围：
 * - 作品目录“项目”文件夹下的每个子文件夹（项目；没有项目说明的补写一份）与登记过的外部项目；
 *   项目里递归扫描（含用户自建子文件夹），跳过顶层的“生成结果 / 素材 / .henji”与嵌套的其他项目；
 * - 作品目录下各类型的独立存放文件夹（递归，跳过其中的项目文件夹）；
 * - 登记过的外部文件夹（另存位置，只扫这一层）。
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
  /** 项目与类型文件夹里递归的最大层数。 */
  maxDepth?: number
}

interface ScanCandidate {
  path: string
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

const DEFAULT_MAX_DEPTH = 8

function emptyReport(startedAt: number): MutableReport {
  return { startedAt, projects: 0, documents: 0, readDocuments: 0, reassignedIds: 0, moved: 0, missing: 0, invalid: 0 }
}

export class DocumentIndexScanner {
  private queue: Promise<unknown> = Promise.resolve()
  private pending: Promise<DocumentIndexScanReport> | null = null

  constructor(private readonly options: DocumentIndexScannerOptions) {}

  private get workspace(): DocumentWorkspace {
    return this.options.workspace
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
  async rebuild(): Promise<DocumentIndexScanReport> {
    await this.queue
    this.workspace.catalog.clearRebuildableIndex()
    this.options.logger.info('作品索引已清空，开始重建', { event: 'documents.index.rebuild.start' })
    return await this.refresh()
  }

  private async scanOnce(): Promise<DocumentIndexScanReport> {
    const startedAt = Date.now()
    const report = emptyReport(startedAt)
    const logger = this.options.logger
    logger.info('开始扫描作品索引', { event: 'documents.index.scan.start' })
    try {
      const projects = await this.scanProjects(report)
      await this.scanDocuments(projects, report)
      await this.sweepProjects(projects, report)
      const result = { ...report, durationMs: Date.now() - startedAt }
      logger.info('作品索引扫描完成', { event: 'documents.index.scan.completed', context: result })
      return result
    } catch (error) {
      logger.error('作品索引扫描失败', { event: 'documents.index.scan.failed', context: { ...report }, error })
      throw error
    }
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
      const stat = await fsp.stat(root).catch(() => null)
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
        report.invalid += 1
        this.options.logger.warn('项目说明无法读取，跳过这个项目', {
          event: 'documents.index.project_invalid',
          context: { root: candidate.root },
          error: error instanceof ProjectManifestError ? error.message : error,
        })
        continue
      }
      if (await this.isDuplicateProject(manifest.id, candidate.root, claimed)) {
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
      catalog.upsertProject(project)
      claimed.set(project.id, this.workspace.containerOfProject(candidate.root, manifest))
      report.projects += 1
    }
    return claimed
  }

  private async isDuplicateProject(id: string, root: string, claimed: ReadonlyMap<string, ResolvedContainer>): Promise<boolean> {
    if (claimed.has(id)) return true
    const existing = this.workspace.catalog.getProject(id)
    if (!existing || samePath(this.workspace.style, existing.path, root)) return false
    const other = await this.workspace.readManifest(existing.path).catch(() => null)
    return other?.id === id
  }

  /** 本轮没扫到的项目：文件夹不在了标缺失，不在扫描范围的旧记录删除。 */
  private async sweepProjects(claimed: ReadonlyMap<string, ResolvedContainer>, report: MutableReport): Promise<void> {
    const catalog = this.workspace.catalog
    const layout = this.workspace.layout()
    const locations = catalog.listExternalLocations().filter((location) => location.kind === 'project')
    for (const project of catalog.listProjects()) {
      if (claimed.has(project.id)) continue
      const exists = await fsp.stat(project.path).then((stat) => stat.isDirectory(), () => false)
      const inScope = samePath(this.workspace.style, path.dirname(project.path), layout.projectsDir)
        || locations.some((location) => samePath(this.workspace.style, location.path, project.path))
      if (!exists) {
        if (!project.missing) {
          catalog.upsertProject({ ...project, missing: true })
          report.missing += 1
        }
      } else if (!inScope) {
        catalog.removeProject(project.id)
      }
    }
  }

  // ==================== 文档 ====================

  private async scanDocuments(projects: ReadonlyMap<string, ResolvedContainer>, report: MutableReport): Promise<void> {
    const candidates: ScanCandidate[] = []
    const depth = this.options.maxDepth ?? DEFAULT_MAX_DEPTH
    for (const container of projects.values()) {
      const manifest = container.manifest as ProjectManifest
      const skipTop = [manifest.folders.generated, manifest.folders.materials, INTERNAL_FOLDER_NAME]
      await this.collect(container.root, container, candidates, { depth, skipTop })
    }
    const user = this.workspace.userContainerNow()
    for (const folder of this.standaloneFolders()) await this.collect(folder, user, candidates, { depth, skipTop: [] })
    for (const location of this.workspace.catalog.listExternalLocations()) {
      if (location.kind === 'folder') await this.collect(location.path, user, candidates, { depth: 0, skipTop: [] })
    }

    const catalog = this.workspace.catalog
    const claimed = new Set<string>()
    const changed: ScanCandidate[] = []
    // 第一轮：位置与修改时间、大小都没变的文件直接认领原 ID，不重新读取。
    for (const candidate of candidates) {
      const row = catalog.getDocumentByPath(candidate.path)
      const projectId = candidate.container.ref.kind === 'project' ? candidate.container.ref.projectId : null
      if (row && !row.missing && !claimed.has(row.id) && row.fileModifiedAt === candidate.mtimeMs
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
    } catch {
      return []
    }
  }

  /** 收集文件夹里的文档文件；跳过符号链接、点开头的文件夹与嵌套的其他项目。 */
  private async collect(
    directory: string,
    container: ResolvedContainer,
    candidates: ScanCandidate[],
    options: { depth: number; skipTop: readonly string[] },
    level = 0,
  ): Promise<void> {
    for (const entry of await this.readDirectory(directory)) {
      if (entry.isSymbolicLink()) continue
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (level >= options.depth || entry.name.startsWith('.')) continue
        if (level === 0 && options.skipTop.some((name) => sameEntryName(name, entry.name))) continue
        if (await this.workspace.readManifest(entryPath).then((manifest) => Boolean(manifest), () => true)) continue
        await this.collect(entryPath, container, candidates, options, level + 1)
        continue
      }
      if (!entry.isFile() || !this.options.kinds.forFileName(entry.name)) continue
      const stat = await fsp.stat(entryPath).catch(() => null)
      if (!stat?.isFile()) continue
      candidates.push({ path: entryPath, container, mtimeMs: stat.mtimeMs, size: stat.size, birthtimeMs: stat.birthtimeMs })
    }
  }

  private async indexCandidate(candidate: ScanCandidate, claimed: ReadonlySet<string>, report: MutableReport): Promise<IndexedDocument | null> {
    const catalog = this.workspace.catalog
    let file: LoadedDocumentFile
    try {
      file = await loadDocumentFile(candidate.path, { kinds: this.options.kinds, adapters: this.options.adapters })
    } catch (error) {
      if (error instanceof DocumentUnsupportedError) return null
      report.invalid += 1
      this.options.logger.debug('跳过无法识别的文档文件', {
        event: 'documents.index.document_invalid',
        context: { path: candidate.path },
        error: error instanceof DocumentFormatError ? error.message : error,
      })
      return null
    }
    report.readDocuments += 1
    const id = file.header.id
    const existing = catalog.getDocument(id)
    if (claimed.has(id) || await this.otherCopyStillThere(existing, candidate.path, id)) {
      file = await this.reassignId(file, candidate.container, report)
    } else if (existing && !samePath(this.workspace.style, existing.path, candidate.path)) {
      report.moved += 1
      this.options.logger.info('识别到文档移动', { event: 'documents.index.document_moved', context: { documentId: id, from: existing.path, to: candidate.path } })
    }
    const row = indexedFromFile(file, candidate.container, summarizeFile(file, candidate.container, this.workspace))
    catalog.upsertDocument(row)
    return row
  }

  private async otherCopyStillThere(existing: IndexedDocument | null, candidatePath: string, id: string): Promise<boolean> {
    if (!existing || samePath(this.workspace.style, existing.path, candidatePath)) return false
    try {
      const other = await loadDocumentFile(existing.path, { kinds: this.options.kinds, adapters: this.options.adapters })
      return other.header.id === id
    } catch {
      return false
    }
  }

  /** 给新发现的副本换新 ID 并写回它的文件头；所在项目的主剪辑指向旧 ID 时一并改写。 */
  private async reassignId(file: LoadedDocumentFile, container: ResolvedContainer, report: MutableReport): Promise<LoadedDocumentFile> {
    const previousId = file.header.id
    const id = this.workspace.randomId()
    if (file.envelope) {
      const envelope = buildDocumentEnvelope({ ...file.envelope, id, draft: file.envelope.draft === true })
      await writeBufferAtomically(file.path, Buffer.from(serializeDocumentEnvelope(envelope), 'utf8'))
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
      const exists = await fsp.stat(row.path).then((stat) => stat.isFile(), () => false)
      if (!exists) {
        if (!row.missing) {
          catalog.upsertDocument({ ...row, missing: true })
          report.missing += 1
        }
      } else if (!scopes.some((scope) => scope(row.path))) {
        catalog.removeDocument(row.id)
      }
    }
  }

  private documentScopes(): Array<(target: string) => boolean> {
    const style = this.workspace.style
    const catalog = this.workspace.catalog
    const projectRoots = catalog.listProjects().map((project) => project.path)
    const folders = catalog.listExternalLocations().filter((location) => location.kind === 'folder').map((location) => location.path)
    return [
      ...projectRoots.map((root) => (target: string) => isPathInside(style, root, target)),
      ...this.standaloneFolders().map((folder) => (target: string) => isPathInside(style, folder, target)),
      ...folders.map((folder) => (target: string) => pathKey(style, path.dirname(target)) === pathKey(style, folder)),
    ]
  }
}

