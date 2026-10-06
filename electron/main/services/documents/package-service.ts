import { ZipArchive } from 'archiver'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'

import { buildDocumentEnvelope, documentIdSchema, serializeDocumentEnvelope, type DocumentEnvelope } from '../../../../src/core/documents/envelope'
import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { entryNameKey, keepBothEntryName, sameEntryName } from '../../../../src/core/documents/naming'
import { buildProjectManifest, INTERNAL_FOLDER_NAME, PROJECT_FOLDER_NAMES, type ProjectManifest } from '../../../../src/core/documents/projectManifest'
import {
  DOCUMENT_PACKAGE_EXTENSION,
  type DocumentContainerRef,
  type ExportDocumentPackageRequest,
  type ExportProjectPackageRequest,
  type ImportPackageRequest,
  type PackageExportResult,
  type PackageImportResult,
} from '../../../../src/core/documents/types'
import { createLocationCodec } from '../../../../src/core/storage/locationCodec'
import { isPathInside, isSafeRelativeSegment, parseAbsolutePath, pathKey, relativeSegments } from '../../../../src/core/storage/pathSyntax'
import { replaceFileAtomically, writeBufferAtomically } from '../fs/atomic-file'
import { moveDirectoryNoOverwrite, EntryExistsError } from '../fs/no-overwrite'
import type { MainLogger } from '../logging/main-logger'
import { isSymbolicLinkEntry, iterateEntries, openEntryReadStream, openZip, readEntryBytes } from '../zip-archive'
import { decodeDocumentContent, loadDocumentFile, type LoadedDocumentFile } from './document-file'
import { DocumentFormatError, DocumentLocationError, ProjectNotFoundError } from './errors'
import type { DocumentIndexScanner } from './index-scanner'
import { rewriteContentPaths } from './media-transfer'
import { readEntryNameKeys } from './name-check'
import type { PackageAdapterRegistry } from './package-adapters'
import type { ProjectService } from './projects'
import type { DocumentRepository } from './repository'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'

/*
 * 通用单文件包（4.1，取代画布专用的 .henjiproj 工程包）。
 *
 * 格式（zip，archiver 写、yauzl 读，与图片文档包、技能安装共用现有依赖）：
 *   henji-package.json   包说明：类型（单个文档 / 整个项目）、名称、来源容器的“生成结果 / 素材”文件夹名、包里的文档清单
 *   content/…            文件按“相对所在容器”的位置原样放：文档、生成结果、素材、`.henji/` 里的内嵌图层包
 *
 * 导出：文档里的位置在包里都是“相对所在容器”的写法（`henji:/…`）。容器之外的文件（外部、作品目录、
 * 别的项目）复制进包里的“素材”并改写引用（与“收集素材”同一规则）；其他文档文件不进单个文档的包
 * （跨文档引用保留原样，打开时按位置 / ID 再找，找不到提示重新定位）；整个项目的包含项目文件夹里的全部文件。
 * 导入：
 * - 文档包：解到程序目录的临时文件夹，再按“收养”放进目标容器（素材按同一规则复制、重名两个都保留、
 *   ID 已被占用时换新）。
 * - 项目包：解到“项目”文件夹里点开头的暂存文件夹（扫描跳过），项目与文档 ID 已被占用的换新
 *   （文档间的 `{ docId, path }` 引用与主剪辑一并改写），再以不覆盖的方式改名到位（重名加序号）。
 * 不信任包内容：条目名逐段校验（不许 `..`、绝对路径、盘符、符号链接），总大小与条目数有上限，
 * 包说明与文档内容按 schema 校验，失败时清掉暂存、不留半个项目。
 */

const MANIFEST_ENTRY = 'henji-package.json'
const CONTENT_PREFIX = 'content/'
const PACKAGE_FORMAT = 'henji-package'
const PACKAGE_VERSION = 1
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_ENTRIES = 100_000
const MAX_TOTAL_BYTES = 64 * 1024 * 1024 * 1024
const MAX_WALK_DEPTH = 16
/** 导出时跳过的文件：写到一半的暂存文件与系统生成的缩略图缓存。 */
const SKIPPED_FILE = /(?:\.tmp|\.partial|\.lock)$|^(?:thumbs\.db|desktop\.ini|\.ds_store)$/i

const folderNameSchema = z.string().min(1).max(120).refine((value) => isSafeRelativeSegment('win32', value) && value !== INTERNAL_FOLDER_NAME, '包里的文件夹名无效。')
const relativePathSchema = z.string().min(1).max(4_096).refine((value) => value.split('/').every((segment) => isSafeRelativeSegment('win32', segment)), '包里的位置无效。')

const packageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  version: z.literal(PACKAGE_VERSION),
  type: z.enum(['document', 'project']),
  name: z.string().min(1).max(200),
  exportedAt: z.string().max(64),
  folders: z.object({ generated: folderNameSchema, materials: folderNameSchema }).strict(),
  /** type 为 document 时的主文档（content/ 之下的相对位置）。 */
  document: z.object({ id: documentIdSchema, path: relativePathSchema }).strict().optional(),
  documents: z.array(z.object({ id: documentIdSchema, path: relativePathSchema }).strict()).max(MAX_ENTRIES),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'document' && !value.document) ctx.addIssue({ code: 'custom', message: '文档包缺少主文档。' })
})

type PackageManifest = z.infer<typeof packageManifestSchema>

export interface DocumentPackageServiceOptions {
  workspace: DocumentWorkspace
  repository: DocumentRepository
  projects: ProjectService
  scanner: Pick<DocumentIndexScanner, 'refresh'>
  kinds: DocumentKindRegistry
  adapters: PackageAdapterRegistry
  logger: MainLogger
  /** 程序目录里的暂存位置（文档包解到这里再收养）。 */
  stagingDirectory: string
  /** 把项目的 `.henji` 设为隐藏（解包出来的文件夹没有隐藏属性）。 */
  hideDirectory?(directory: string): Promise<void>
}

interface PackageEntry {
  /** 包内位置（content/ 之下，正斜杠）。 */
  name: string
  /** 磁盘上的来源文件；与 bytes 二选一。 */
  source?: string
  bytes?: Buffer
}

/** 包里的条目名集合（比较不分大小写，与 Windows 文件系统一致），用于给收集进来的素材挑不重名的位置。 */
class EntryNames {
  private readonly taken = new Set<string>()
  has(relative: string): boolean { return this.taken.has(this.key(relative)) }
  add(relative: string): void { this.taken.add(this.key(relative)) }
  private key(relative: string): string { return relative.split('/').map((segment) => entryNameKey(segment)).join('/') }
}

export class DocumentPackageService {
  constructor(private readonly options: DocumentPackageServiceOptions) {}

  private get workspace(): DocumentWorkspace {
    return this.options.workspace
  }

  // ==================== 导出 ====================

  /** 导出单个文档：文档本身 + 它引用的素材与内嵌图层包。 */
  async exportDocument(request: ExportDocumentPackageRequest): Promise<PackageExportResult> {
    return await this.logged('export_document', { documentId: request.target.id }, async () => {
      const file = await this.options.repository.locateFile(request.target)
      const container = await this.workspace.containerForPath(file.path)
      const names = new EntryNames()
      const entries: PackageEntry[] = []
      const missingPaths: string[] = []
      const documentEntry = path.basename(file.path)
      names.add(documentEntry)
      if (file.envelope) {
        const packed = await this.packDocumentContent(file, container, names, { includeContainerFiles: true })
        entries.push(...packed.entries)
        missingPaths.push(...packed.missingPaths)
        entries.unshift({ name: documentEntry, bytes: packed.bytes })
      } else {
        entries.unshift({ name: documentEntry, source: file.path })
      }
      const manifest: PackageManifest = {
        format: PACKAGE_FORMAT,
        version: PACKAGE_VERSION,
        type: 'document',
        name: path.basename(file.path, file.kind.extension),
        exportedAt: this.workspace.now().toISOString(),
        folders: this.folderNames(container),
        document: { id: file.header.id, path: documentEntry },
        documents: [{ id: file.header.id, path: documentEntry }],
      }
      const target = await this.destinationFor(request.destination, manifest.name)
      await this.writePackage(target, manifest, entries)
      return { path: target, files: entries.length, missingPaths }
    })
  }

  /** 导出整个项目：项目文件夹里的全部文件，加上项目里文档引用到的、项目之外的素材。 */
  async exportProject(request: ExportProjectPackageRequest): Promise<PackageExportResult> {
    return await this.logged('export_project', { projectId: request.projectId }, async () => {
      const container = await this.workspace.resolveContainer({ kind: 'project', projectId: request.projectId }).catch(async (error: unknown) => {
        if (!(error instanceof ProjectNotFoundError)) throw error
        await this.options.scanner.refresh()
        return await this.workspace.resolveContainer({ kind: 'project', projectId: request.projectId })
      })
      const files = await this.walk(container.root)
      const names = new EntryNames()
      for (const relative of files) names.add(relative)
      const entries: PackageEntry[] = []
      const documents: PackageManifest['documents'] = []
      const missingPaths: string[] = []
      for (const relative of files) {
        const absolute = path.join(container.root, ...relative.split('/'))
        const kind = this.options.kinds.forFileName(path.basename(absolute))
        if (!kind) {
          entries.push({ name: relative, source: absolute })
          continue
        }
        let file: LoadedDocumentFile
        try {
          file = await loadDocumentFile(absolute, this.fileDependencies())
        } catch (error) {
          // 读不懂的文档文件（损坏、版本过新）原样放进包里，导入后由扫描如实报告
          this.options.logger.warn('导出项目时有文档文件读不懂，原样放进包里', { event: 'documents.package.export.unreadable_document', context: { relative }, error })
          entries.push({ name: relative, source: absolute })
          continue
        }
        documents.push({ id: file.header.id, path: relative })
        if (!file.envelope) {
          entries.push({ name: relative, source: absolute })
          continue
        }
        const packed = await this.packDocumentContent(file, container, names, { includeContainerFiles: false })
        entries.push({ name: relative, bytes: packed.bytes }, ...packed.entries)
        missingPaths.push(...packed.missingPaths)
      }
      const manifest: PackageManifest = {
        format: PACKAGE_FORMAT,
        version: PACKAGE_VERSION,
        type: 'project',
        name: path.basename(container.root),
        exportedAt: this.workspace.now().toISOString(),
        folders: this.folderNames(container),
        documents,
      }
      const target = await this.destinationFor(request.destination, manifest.name)
      await this.writePackage(target, manifest, entries)
      return { path: target, files: entries.length, missingPaths }
    })
  }

  /**
   * 文档内容换成包里的写法：容器里的文件保持相对位置（includeContainerFiles 时一并放进包里；整个项目时
   * 项目文件夹里的文件已经都在包里），容器之外的文件复制进包里的“素材”并改写引用。其他文档文件不收。
   */
  private async packDocumentContent(
    file: LoadedDocumentFile,
    container: ResolvedContainer,
    names: EntryNames,
    options: { includeContainerFiles: boolean },
  ): Promise<{ bytes: Buffer; entries: PackageEntry[]; missingPaths: string[] }> {
    const style = this.workspace.style
    const decoded = decodeDocumentContent(file, container, this.workspace)
    const root = parseAbsolutePath(style, container.root)
    if (!root) throw new DocumentLocationError('文档所在位置无效。')
    const materials = path.basename(container.materialsDir)
    const entries: PackageEntry[] = []
    const missingPaths: string[] = []
    const mapping = new Map<string, string>()
    for (const reference of decoded.report.references) {
      const key = pathKey(style, reference.path)
      if (!key || mapping.has(key) || this.options.kinds.forFileName(path.basename(reference.path))) continue
      const stat = await fsp.stat(reference.path).catch(() => null)
      if (!stat?.isFile()) {
        if (!stat && !missingPaths.includes(reference.path)) missingPaths.push(reference.path)
        continue
      }
      const parsed = parseAbsolutePath(style, reference.path)
      const inside = parsed ? relativeSegments(style, root, parsed) : null
      if (inside?.length) {
        if (!options.includeContainerFiles) continue
        const relative = inside.join('/')
        if (!names.has(relative)) {
          names.add(relative)
          entries.push({ name: relative, source: reference.path })
        }
        continue
      }
      // 容器之外的文件：放进包里的“素材”，重名（内容不同）时加序号
      const base = path.basename(reference.path)
      const extension = path.extname(base)
      const stem = keepBothEntryName(path.basename(base, extension), (candidate) => names.has(`${materials}/${candidate}${extension}`))
      const relative = `${materials}/${stem}${extension}`
      names.add(relative)
      entries.push({ name: relative, source: reference.path })
      mapping.set(key, path.join(container.root, materials, `${stem}${extension}`))
    }
    const content = rewriteContentPaths(decoded.content, mapping, style)
    const encoded = createLocationCodec(this.workspace.locationContext(container)).encodeContent(content)
    const envelope = file.envelope as DocumentEnvelope
    const bytes = Buffer.from(serializeDocumentEnvelope(buildDocumentEnvelope({
      kind: envelope.kind,
      kindVersion: file.kind.version,
      id: envelope.id,
      name: envelope.name,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      revision: envelope.revision,
      draft: envelope.draft === true,
      content: encoded.content,
    })), 'utf8')
    return { bytes, entries, missingPaths }
  }

  /** 项目文件夹里的全部文件（相对位置，正斜杠）；跳过符号链接、嵌套项目与暂存文件。 */
  private async walk(root: string): Promise<string[]> {
    const result: string[] = []
    const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_WALK_DEPTH) return
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || SKIPPED_FILE.test(entry.name)) continue
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (depth > 0 && entry.name !== INTERNAL_FOLDER_NAME && await this.workspace.readManifest(absolute).catch(() => null)) continue
          await visit(absolute, relative, depth + 1)
        } else if (entry.isFile()) {
          result.push(relative)
        }
      }
    }
    await visit(root, '', 0)
    return result.sort()
  }

  private folderNames(container: ResolvedContainer): PackageManifest['folders'] {
    return { generated: path.basename(container.generatedDir), materials: path.basename(container.materialsDir) }
  }

  /** 包文件位置：给了就用（作品与程序目录之外也行，但不能在程序目录里）；省略时进作品目录“导出”并自动加序号。 */
  private async destinationFor(destination: string | undefined, name: string): Promise<string> {
    if (destination !== undefined) {
      this.workspace.assertWritableLocation(destination)
      const resolved = path.resolve(destination)
      return resolved.toLowerCase().endsWith(DOCUMENT_PACKAGE_EXTENSION) ? resolved : `${resolved}${DOCUMENT_PACKAGE_EXTENSION}`
    }
    const folder = this.workspace.layout().exportsDir
    await fsp.mkdir(folder, { recursive: true })
    const taken = await readEntryNameKeys(folder)
    const stem = keepBothEntryName(name, (candidate) => taken.has(entryNameKey(`${candidate}${DOCUMENT_PACKAGE_EXTENSION}`)))
    return path.join(folder, `${stem}${DOCUMENT_PACKAGE_EXTENSION}`)
  }

  /** 写到同目录的暂存文件，完整写完后原子替换，失败时目标不变。 */
  private async writePackage(target: string, manifest: PackageManifest, entries: readonly PackageEntry[]): Promise<void> {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const staged = `${target}.${randomUUID()}.tmp`
    try {
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(staged, { flags: 'wx' })
        const archive = new ZipArchive({ zlib: { level: 6 } })
        output.on('close', resolve)
        output.on('error', reject)
        archive.on('error', reject)
        archive.on('warning', reject)
        archive.pipe(output)
        archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: MANIFEST_ENTRY })
        for (const entry of entries) {
          const name = `${CONTENT_PREFIX}${entry.name}`
          // 媒体本身已压缩，存储即可；文档 JSON 压缩
          if (entry.bytes) archive.append(entry.bytes, { name })
          // zip-stream 支持按条目 store（archiver 类型没写这个字段）
          else archive.file(entry.source as string, { name, store: true } as Parameters<ZipArchive['file']>[1])
        }
        archive.finalize().catch(reject)
      })
      await replaceFileAtomically(staged, target)
    } catch (error) {
      await fsp.rm(staged, { force: true }).catch(() => undefined)
      throw error
    }
  }

  // ==================== 导入 ====================

  async importPackage(request: ImportPackageRequest): Promise<PackageImportResult> {
    return await this.logged('import', { container: request.container }, async () => {
      if (!path.isAbsolute(request.source)) throw new DocumentLocationError('包文件位置无效。')
      const source = path.resolve(request.source)
      const manifest = await this.readManifest(source)
      if (manifest.type === 'project') return await this.importProject(source, manifest)
      return await this.importDocument(source, manifest, request.container ?? { kind: 'user' })
    })
  }

  private async importDocument(source: string, manifest: PackageManifest, container: DocumentContainerRef): Promise<PackageImportResult> {
    const staging = path.join(this.options.stagingDirectory, `import-${randomUUID()}`)
    try {
      await this.extract(source, staging)
      const main = manifest.document as NonNullable<PackageManifest['document']>
      const stagedContainer: ResolvedContainer = {
        ref: { kind: 'project', projectId: `package-${randomUUID()}` },
        root: staging,
        locale: 'zh',
        manifest: null,
        generatedDir: path.join(staging, manifest.folders.generated),
        materialsDir: path.join(staging, manifest.folders.materials),
      }
      const result = await this.options.repository.adoptDocument({
        sourcePath: path.join(staging, ...main.path.split('/')),
        sourceContainer: stagedContainer,
        destination: container,
        onConflict: 'keepBoth',
        newId: 'whenTaken',
      })
      return { type: 'document', meta: result.meta, copiedFiles: result.copiedFiles }
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async importProject(source: string, manifest: PackageManifest): Promise<PackageImportResult> {
    const projectsDir = this.workspace.layout().projectsDir
    const staging = path.join(projectsDir, `.henji-new-${randomUUID()}`)
    let published: string | null = null
    try {
      await this.extract(source, staging)
      const catalog = this.workspace.catalog
      // 项目说明：包里没有时按包说明补一份；ID 已被占用（同一个项目导入第二次）时换新
      const existing = await this.workspace.readManifest(staging).catch(() => null)
      let projectManifest: ProjectManifest = existing ?? buildProjectManifest({
        id: this.workspace.randomId(),
        createdAt: this.workspace.now().toISOString(),
        locale: Object.values(PROJECT_FOLDER_NAMES.en).some((name) => sameEntryName(name, manifest.folders.generated)) ? 'en' : 'zh',
        draft: false,
      })
      if (catalog.getProject(projectManifest.id)) projectManifest = { ...projectManifest, id: this.workspace.randomId() }
      // 文档 ID：已被占用或包里重复的换新，再改写文档之间的 { docId, path } 引用与主剪辑
      const idMap = new Map<string, string>()
      const seen = new Set<string>()
      const documents: Array<{ path: string; file: LoadedDocumentFile }> = []
      for (const entry of manifest.documents) {
        const absolute = path.join(staging, ...entry.path.split('/'))
        const file = await loadDocumentFile(absolute, this.fileDependencies()).catch(() => null)
        if (!file) continue
        const id = file.header.id
        if (seen.has(id) || catalog.getDocument(id)) idMap.set(id, this.workspace.randomId())
        seen.add(id)
        documents.push({ path: absolute, file })
      }
      for (const { path: filePath, file } of documents) {
        const nextId = idMap.get(file.header.id)
        if (file.envelope) {
          const content = idMap.size ? remapDocumentLinks(file.envelope.content, idMap) : file.envelope.content
          if (!nextId && content === file.envelope.content) continue
          const envelope = buildDocumentEnvelope({ ...file.envelope, draft: file.envelope.draft === true, id: nextId ?? file.envelope.id, content })
          await writeBufferAtomically(filePath, Buffer.from(serializeDocumentEnvelope(envelope), 'utf8'))
        } else if (nextId) {
          const adapter = this.options.adapters.get(file.kind.id)
          if (!adapter) throw new DocumentFormatError('包里有暂不支持的文档类型。')
          await adapter.writeHeader(filePath, { id: nextId })
        }
      }
      const mainId = projectManifest.mainVideoEditId
      projectManifest = buildProjectManifest({
        ...projectManifest,
        draft: false,
        mainVideoEditId: mainId ? idMap.get(mainId) ?? mainId : undefined,
      })
      await this.workspace.writeManifest(staging, projectManifest)
      // 以不覆盖的方式改名到位，重名加序号
      for (let attempt = 0; attempt < 100 && !published; attempt += 1) {
        const taken = await readEntryNameKeys(projectsDir)
        const name = keepBothEntryName(manifest.name, (candidate) => taken.has(entryNameKey(candidate)))
        const target = path.join(projectsDir, name)
        try {
          await moveDirectoryNoOverwrite(staging, target)
          published = target
        } catch (error) {
          if (!(error instanceof EntryExistsError)) throw error
        }
      }
      if (!published) throw new Error('同名的项目过多，请先整理“项目”文件夹。')
      await this.options.hideDirectory?.(path.join(published, INTERNAL_FOLDER_NAME)).catch((error: unknown) => {
        this.options.logger.warn('内部文件夹未能设为隐藏', { event: 'documents.package.hide_failed', context: { published }, error })
      })
      this.workspace.catalog.upsertProject(await this.workspace.describeProject(published, projectManifest))
      await this.options.scanner.refresh()
      const project = this.options.projects.list().find((item) => item.id === projectManifest.id)
      if (!project) throw new ProjectNotFoundError(projectManifest.id)
      this.options.logger.info('项目包已导入', {
        event: 'documents.package.project_imported',
        context: { projectId: project.id, documents: documents.length, reassigned: idMap.size },
      })
      return { type: 'project', project, documents: documents.length }
    } catch (error) {
      if (!published) await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private async readManifest(source: string): Promise<PackageManifest> {
    const archive = await openZip(source).catch((error: unknown) => {
      throw new DocumentFormatError('不是痕迹AI的单文件包，或文件已损坏。', { cause: error })
    })
    try {
      for await (const entry of formatErrors(iterateEntries(archive))) {
        if (entry.fileName !== MANIFEST_ENTRY) continue
        if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw new DocumentFormatError('包说明过大，文件可能已损坏。')
        const text = (await readEntryBytes(archive, entry, MANIFEST_ENTRY)).toString('utf8')
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch (error) {
          throw new DocumentFormatError('包说明已损坏。', { cause: error })
        }
        if (typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === PACKAGE_FORMAT
          && typeof (raw as { version?: unknown }).version === 'number' && (raw as { version: number }).version > PACKAGE_VERSION) {
          throw new DocumentFormatError('这个包由更新版本的痕迹AI导出，请升级后再导入。')
        }
        const parsed = packageManifestSchema.safeParse(raw)
        if (!parsed.success) throw new DocumentFormatError(`包说明无效：${parsed.error.issues[0]?.message ?? '格式错误'}`)
        return parsed.data
      }
    } finally {
      archive.close()
    }
    throw new DocumentFormatError('不是痕迹AI的单文件包（缺少包说明）。')
  }

  /** 把 content/ 下的条目解到 target（不存在时新建）；逐条校验位置、总大小与条目数。 */
  private async extract(source: string, target: string): Promise<void> {
    await fsp.mkdir(target, { recursive: true })
    const archive = await openZip(source)
    let count = 0
    let total = 0
    try {
      for await (const entry of formatErrors(iterateEntries(archive))) {
        if (entry.fileName === MANIFEST_ENTRY) continue
        if (!entry.fileName.startsWith(CONTENT_PREFIX)) throw new DocumentFormatError(`包里有无法识别的条目：${entry.fileName}`)
        if (isSymbolicLinkEntry(entry)) throw new DocumentFormatError(`包里有符号链接：${entry.fileName}`)
        const relative = entry.fileName.slice(CONTENT_PREFIX.length)
        if (relative.endsWith('/')) continue
        const segments = relative.split('/')
        if (!segments.every((segment) => isSafeRelativeSegment('win32', segment))) throw new DocumentFormatError(`包里的位置无效：${entry.fileName}`)
        count += 1
        total += entry.uncompressedSize
        if (count > MAX_ENTRIES || total > MAX_TOTAL_BYTES) throw new DocumentFormatError('包里的文件过多或过大。')
        const destination = path.join(target, ...segments)
        if (!isPathInside(this.workspace.style, target, destination)) throw new DocumentFormatError(`包里的位置无效：${entry.fileName}`)
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        const stream = await openEntryReadStream(archive, entry, entry.fileName)
        await pipeline(stream, fs.createWriteStream(destination, { flags: 'wx' }))
      }
    } finally {
      archive.close()
    }
  }

  // ==================== 内部 ====================

  private fileDependencies(): { kinds: DocumentKindRegistry; adapters: PackageAdapterRegistry } {
    return { kinds: this.options.kinds, adapters: this.options.adapters }
  }

  private async logged<T>(action: string, context: Record<string, unknown>, operation: () => Promise<T>): Promise<T> {
    const logger = this.options.logger
    logger.info('开始处理单文件包', { event: `documents.package.${action}.start`, context })
    try {
      const result = await operation()
      logger.info('单文件包处理完成', { event: `documents.package.${action}.completed`, context })
      return result
    } catch (error) {
      const expected = [DocumentFormatError, DocumentLocationError, ProjectNotFoundError].some((type) => error instanceof type)
      logger[expected ? 'warn' : 'error']('单文件包处理失败', { event: `documents.package.${action}.failed`, context, error })
      throw error
    }
  }
}

/** zip 读取库对损坏或不安全条目（如 `../`）报的错，统一成“包格式错误”。 */
async function* formatErrors<T>(entries: AsyncGenerator<T>): AsyncGenerator<T> {
  while (true) {
    let next: IteratorResult<T>
    try {
      next = await entries.next()
    } catch (error) {
      throw new DocumentFormatError('包文件已损坏或含有不安全的条目。', { cause: error })
    }
    if (next.done) return
    yield next.value
  }
}

/** 文档之间的引用 `{ docId, path }`：换了 ID 的文档同步改写引用里的 docId。 */
export function remapDocumentLinks(content: unknown, idMap: ReadonlyMap<string, string>): unknown {
  let changed = false
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const mapped = value.map(visit)
      return mapped.some((item, index) => item !== value[index]) ? mapped : value
    }
    if (typeof value !== 'object' || value === null) return value
    const record = value as Record<string, unknown>
    let next: Record<string, unknown> | null = null
    for (const [key, item] of Object.entries(record)) {
      let mapped = visit(item)
      if (key === 'docId' && typeof item === 'string' && typeof record.path === 'string' && idMap.has(item)) mapped = idMap.get(item)
      if (mapped !== item) {
        next ??= { ...record }
        next[key] = mapped
      }
    }
    if (next) changed = true
    return next ?? value
  }
  const result = visit(content)
  return changed ? result : content
}
