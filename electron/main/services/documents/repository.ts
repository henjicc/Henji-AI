import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  buildDocumentEnvelope,
  DocumentFormatError,
  serializeDocumentEnvelope,
  type DocumentEnvelope,
} from '../../../../src/core/documents/envelope'
import type { DocumentKindDescriptor, DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { entryNameKey, keepBothEntryName, untitledEntryName } from '../../../../src/core/documents/naming'
import type {
  CreateDocumentRequest,
  DocumentContainerRef,
  DocumentLink,
  DocumentLinkResolution,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
  FinalizeDocumentRequest,
  ImportFileRequest,
  ImportFileResult,
  MoveDocumentRequest,
  NameCheckRequest,
  NameCheckResult,
  RenameDocumentRequest,
  SaveDocumentRequest,
} from '../../../../src/core/documents/types'
import { createLocationCodec, type LocationReport } from '../../../../src/core/storage/locationCodec'
import { isPathInside, pathKey, samePath } from '../../../../src/core/storage/pathSyntax'
import { writeBufferAtomically } from '../fs/atomic-file'
import { withFileLock } from '../fs/file-lock'
import { copyFileNoOverwrite, createFileExclusively, EntryExistsError, moveFileNoOverwrite } from '../fs/no-overwrite'
import { KeyedSerialExecutor } from '../image-editor-v3/serial-executor'
import type { MainLogger } from '../logging/main-logger'
import {
  decodeDocumentContent,
  describeWrittenDocument,
  documentNameOf,
  indexedFromFile,
  loadDocumentFile,
  metaFromFile,
  summarizeFile,
  type DecodedDocumentContent,
  type LoadedDocumentFile,
} from './document-file'
import {
  DocumentLocationError,
  DocumentNameConflictError,
  DocumentNameInvalidError,
  DocumentNotEmptyError,
  DocumentNotFoundError,
  DocumentRevisionConflictError,
  DocumentUnsupportedError,
  FileInUseError,
  isInUseError,
  ProjectNotFoundError,
} from './errors'
import { collectContainerMedia, copyKeepingBoth, rewriteContentPaths, transferContainerMedia } from './media-transfer'
import { checkEntryName, readEntryNameKeys, requireEntryName } from './name-check'
import type { PackageAdapterRegistry, PackageDocumentAdapter, PackageDocumentHeaderPatch } from './package-adapters'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'

/*
 * 主进程文档仓库（实施方案 2.4、2.5、2.8，存储底座 2.2）。
 *
 * - 文件是唯一真相：读写都直接作用于作品目录或项目文件夹里的文档文件，索引只是投影（写后同步更新）。
 * - 换算只在这里发生：读出时把位置换回绝对路径，保存时换成相对写法；工具在内存里只见绝对路径。
 * - 按文档串行：同一 ID 的写操作在进程内串行，并用程序目录里的锁文件与无窗口助手进程互斥。
 * - 版本核对：保存时核对 expectedRevision，被别处改过就报冲突；改名、转正不改内容，不加版本；
 *   换容器时素材被复制、引用被改写，版本加一（打开中的会话需要重新读取）。
 * - 原子写入：整份写完再替换；新建、改名、移动以“不覆盖”的方式发布，检查后被抢先建了同名会报重名。
 * - 名称以文件名为准（项目名就是文件夹名，同理）；文件头里的 name 在每次写入时同步。
 */

export interface DocumentRepositoryOptions {
  workspace: DocumentWorkspace
  kinds: DocumentKindRegistry
  adapters: PackageAdapterRegistry
  logger: MainLogger
  /** 跨进程文档锁所在目录（程序目录）。 */
  lockDirectory: string
  trashItem(filePath: string): Promise<void>
  showItemInFolder(filePath: string): void
  /** 授权媒体协议读取这些目录（作品目录始终已授权）。 */
  grantMediaRoots(directories: readonly string[]): void
  /** 文档移到回收站或删除后清掉通用封面。 */
  removeCover?(docId: string): Promise<void>
  /** 索引里找不到项目时先刷新项目再重试（索引可能落后于磁盘）。 */
  refreshProjects?(): Promise<void>
}

type NamingMode = { mode: 'exact'; name: string } | { mode: 'keepBoth'; name: string } | { mode: 'untitled'; base: string }

interface RelocateOptions {
  naming: NamingMode
  draft: boolean
  /** 目标不在扫描范围时登记为外部位置（另存位置）。 */
  registerExternal: boolean
  destination?: ResolvedContainer
}

const MAX_NAME_ATTEMPTS = 100
const REFERENCE_CHECK_CONCURRENCY = 16

export interface AdoptDocumentRequest {
  /** 要收养的文档文件（不会被改动）。 */
  sourcePath: string
  /** 它所在的容器：内容里“相对所在容器”的位置按它解析，被引用的素材从这里复制。 */
  sourceContainer: ResolvedContainer
  destination: DocumentContainerRef
  name?: string
  /** 默认 keepBoth。 */
  onConflict?: 'fail' | 'keepBoth'
  /** 默认 whenTaken：索引里已有同 ID 时换新。 */
  newId?: 'always' | 'whenTaken'
}
/** 内容里的跨文档引用：形状恰好是 { docId: 字符串, path: 字符串 } 的对象（与 package-service 改写 ID 的规则一致）。 */
function findDocumentLinks(content: unknown): DocumentLink[] {
  const found: DocumentLink[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.docId === 'string' && typeof record.path === 'string') found.push({ docId: record.docId, path: record.path })
    for (const item of Object.values(record)) visit(item)
  }
  visit(content)
  return found
}

/** 把内容里指向原文档的 { docId, path } 改成副本的 ID 与位置。 */
function rewriteDocumentLinks(content: unknown, links: ReadonlyMap<string, DocumentLink>): unknown {
  if (!links.size) return content
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (typeof value !== 'object' || value === null) return value
    const record = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) next[key] = visit(item)
    const link = typeof record.docId === 'string' && typeof record.path === 'string' ? links.get(record.docId) : undefined
    if (link) { next.docId = link.docId; next.path = link.path }
    return next
  }
  return visit(content)
}

/** 用户可以自行处理的失败（重名、找不到、版本冲突等）记 warn，其余记 error。 */
const EXPECTED_FAILURES = [
  DocumentNameConflictError, DocumentNameInvalidError, DocumentNotFoundError, DocumentLocationError,
  DocumentNotEmptyError, DocumentRevisionConflictError, DocumentUnsupportedError, FileInUseError, ProjectNotFoundError,
]

function sameContainer(left: DocumentContainerRef, right: DocumentContainerRef): boolean {
  if (left.kind === 'user' || right.kind === 'user') return left.kind === right.kind
  return left.projectId === right.projectId
}

export class DocumentRepository {
  private readonly executor = new KeyedSerialExecutor()

  constructor(private readonly options: DocumentRepositoryOptions) {}

  private get workspace(): DocumentWorkspace {
    return this.options.workspace
  }

  private get logger(): MainLogger {
    return this.options.logger
  }

  // ==================== 公共操作 ====================

  async read(target: DocumentTarget): Promise<DocumentReadResult> {
    try {
      const file = await this.locate(target)
      if (!file.envelope) throw new DocumentUnsupportedError('这种文档请在它自己的编辑器里打开。')
      const container = await this.workspace.containerForPath(file.path)
      const decoded = await this.decode(file, container)
      const references = await this.inspectReferences(decoded.report)
      this.grantReferences(container, decoded.report, references.externalDirectories)
      this.warnProgramReferences('read', file, decoded.report)
      this.logger.debug('文档已读取', {
        event: 'documents.read.completed',
        context: { documentId: file.header.id, kind: file.kind.id, missing: references.missingPaths.length, unresolved: decoded.report.unresolved.length },
      })
      return {
        meta: metaFromFile(file, container),
        content: decoded.content,
        missingPaths: references.missingPaths,
        externalDirectories: references.externalDirectories,
        unresolved: decoded.report.unresolved,
      }
    } catch (error) {
      this.logFailure('read', { documentId: target.id }, error)
      throw error
    }
  }

  /** 新建：没给名字时为草稿，自动起名“未命名画布 N”；给了名字按用户输入处理（重名报错）。 */
  async create(request: CreateDocumentRequest): Promise<DocumentReadResult> {
    const kind = this.options.kinds.require(request.kind)
    if (kind.storage !== 'json') throw new DocumentUnsupportedError('这种文档请在它自己的编辑器里新建。')
    return await this.logged('create', { kind: kind.id, container: request.container }, async () => {
      const container = await this.resolveContainer(request.container)
      if (container.ref.kind === 'user' && !kind.standaloneFolderNames) throw new DocumentLocationError('这种文档只能放在项目里。')
      const folder = this.workspace.defaultDocumentFolder(kind, container)
      const content = this.validateContent(kind, request.content === undefined ? kind.createEmptyContent() : request.content)
      const userName = request.name === undefined ? null : requireEntryName(request.name)
      const draft = request.draft ?? userName === null
      const encoded = this.encode(container, content)
      const now = this.workspace.now().toISOString()
      if (request.id !== undefined && this.workspace.catalog.getDocument(request.id)) throw new DocumentLocationError('已有同一 ID 的文档。')
      const id = request.id ?? this.workspace.randomId()
      const written = await this.writeNewDocumentFile(folder, kind, (name) => buildDocumentEnvelope({
        kind: kind.id, kindVersion: kind.version, id, name, createdAt: now, updatedAt: now, revision: 0, draft, content: encoded.content,
      }), userName === null ? { mode: 'untitled', base: kind.untitledNames[container.locale] } : { mode: 'exact', name: userName })
      const file = await describeWrittenDocument(kind, written.path, written.envelope)
      this.workspace.catalog.upsertDocument(indexedFromFile(file, container, kind.summarize(content)))
      const references = await this.inspectReferences(encoded.report)
      this.grantReferences(container, encoded.report, references.externalDirectories)
      this.warnProgramReferences('create', file, encoded.report)
      return {
        meta: metaFromFile(file, container),
        content,
        missingPaths: references.missingPaths,
        externalDirectories: references.externalDirectories,
        unresolved: [],
      }
    })
  }

  /** 保存内容：核对版本、换算位置、原子替换；内容与磁盘一致时不写文件。 */
  async save(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
    return await this.exclusive(request.target.id, async () => {
      const context: Record<string, unknown> = { documentId: request.target.id, expectedRevision: request.expectedRevision, force: request.force === true }
      try {
        const file = await this.locate(request.target)
        if (!file.envelope) throw new DocumentUnsupportedError('这种文档请在它自己的编辑器里保存。')
        context.kind = file.kind.id
        if (!request.force && file.header.revision !== request.expectedRevision) {
          throw new DocumentRevisionConflictError(file.header.id, request.expectedRevision, file.header.revision)
        }
        const content = this.validateContent(file.kind, request.content)
        const container = await this.workspace.containerForPath(file.path)
        const encoded = this.encode(container, content)
        const name = documentNameOf(file.kind, file.path)
        const unchanged = file.envelope.kindVersion === file.kind.version
          && file.envelope.name === name
          && JSON.stringify(encoded.content) === JSON.stringify(file.envelope.content)
        if (unchanged) return { meta: metaFromFile(file, container), unchanged: true }
        const envelope = this.withHeader(file.envelope, {
          name,
          kindVersion: file.kind.version,
          updatedAt: this.workspace.now().toISOString(),
          revision: file.header.revision + 1,
          content: encoded.content,
        })
        await writeBufferAtomically(file.path, this.bytes(envelope))
        const saved = await describeWrittenDocument(file.kind, file.path, envelope)
        this.workspace.catalog.upsertDocument(indexedFromFile(saved, container, file.kind.summarize(content)))
        this.warnProgramReferences('save', saved, encoded.report)
        this.logger.debug('文档已保存', { event: 'documents.save.completed', context: { ...context, revision: envelope.revision } })
        return { meta: metaFromFile(saved, container), unchanged: false }
      } catch (error) {
        this.logFailure('save', context, error)
        throw error
      }
    })
  }

  /** 改名（文件名与文件头同步）；用户输入的名字重名时报错，不加后缀。 */
  async rename(request: RenameDocumentRequest): Promise<DocumentMeta> {
    return await this.exclusive(request.target.id, async () => await this.logged('rename', { documentId: request.target.id }, async () => {
      const file = await this.locate(request.target)
      const name = requireEntryName(request.name)
      const target = path.join(path.dirname(file.path), `${name}${file.kind.extension}`)
      const container = await this.workspace.containerForPath(file.path)
      if (target === file.path) return metaFromFile(file, container)
      const updated = await this.rewriteInPlace(file, target, { name, draft: file.header.draft }, container)
      return metaFromFile(updated, container)
    }))
  }

  /** 草稿转正：起名并去掉草稿标记；给了另一个文件夹时整体移过去并按需登记为外部位置。 */
  async finalize(request: FinalizeDocumentRequest): Promise<DocumentTransferResult> {
    return await this.exclusive(request.target.id, async () => await this.logged('finalize', { documentId: request.target.id, relocated: request.folder !== undefined }, async () => {
      const file = await this.locate(request.target)
      const name = requireEntryName(request.name)
      const currentFolder = path.dirname(file.path)
      if (request.folder !== undefined) this.workspace.assertWritableLocation(request.folder)
      const folder = request.folder === undefined ? currentFolder : path.resolve(request.folder)
      if (samePath(this.workspace.style, folder, currentFolder)) {
        const container = await this.workspace.containerForPath(file.path)
        const updated = await this.rewriteInPlace(file, path.join(currentFolder, `${name}${file.kind.extension}`), { name, draft: false }, container)
        return { meta: metaFromFile(updated, container), copiedFiles: 0, missingPaths: [] }
      }
      return await this.relocate(file, folder, { naming: { mode: 'exact', name }, draft: false, registerExternal: true })
    }))
  }

  /** 移到别的容器（移入 / 移出项目、在项目之间移动），原容器里用到的素材复制过去。 */
  async move(request: MoveDocumentRequest): Promise<DocumentTransferResult> {
    return await this.exclusive(request.target.id, async () => await this.logged('move', { documentId: request.target.id, container: request.container }, async () => {
      const file = await this.locate(request.target)
      const destination = await this.resolveContainer(request.container)
      const source = await this.workspace.containerForPath(file.path)
      if (sameContainer(source.ref, destination.ref)) return { meta: metaFromFile(file, source), copiedFiles: 0, missingPaths: [] }
      if (destination.ref.kind === 'user' && !file.kind.standaloneFolderNames) throw new DocumentLocationError('这种文档只能放在项目里。')
      const name = documentNameOf(file.kind, file.path)
      return await this.relocate(file, this.workspace.defaultDocumentFolder(file.kind, destination), {
        naming: request.onConflict === 'keepBoth' ? { mode: 'keepBoth', name } : { mode: 'exact', name },
        draft: file.header.draft,
        registerExternal: false,
        destination,
      })
    }))
  }

  /**
   * 创建副本（新 ID、非草稿）；同名时按调用方要求报错或加序号。默认与原件同一文件夹；
   * 给了 container 时复制进那个容器（4.1“复制进本项目”），原容器里用到的素材一并复制过去。
   */
  async duplicate(request: DuplicateDocumentRequest): Promise<DocumentTransferResult> {
    return await this.exclusive(request.target.id, async () => await this.logged('duplicate', { documentId: request.target.id, container: request.container }, async () => {
      const file = await this.locate(request.target)
      if (request.container) {
        const source = await this.workspace.containerForPath(file.path)
        if (!sameContainer(source.ref, request.container)) {
          return await this.adoptFile(file, source, await this.resolveContainer(request.container), {
            name: request.name === undefined ? undefined : requireEntryName(request.name),
            onConflict: request.onConflict ?? 'fail',
            newId: 'always',
          })
        }
      }
      const name = request.name === undefined ? documentNameOf(file.kind, file.path) : requireEntryName(request.name)
      const naming: NamingMode = request.onConflict === 'keepBoth' ? { mode: 'keepBoth', name } : { mode: 'exact', name }
      const folder = path.dirname(file.path)
      const container = await this.workspace.containerForPath(file.path)
      const id = this.workspace.randomId()
      const now = this.workspace.now().toISOString()
      let copy: LoadedDocumentFile
      if (file.envelope) {
        const source = file.envelope
        const written = await this.writeNewDocumentFile(folder, file.kind, (fileName) => this.withHeader(source, {
          id, name: fileName, draft: false, createdAt: now, updatedAt: now, revision: 0,
        }), naming)
        copy = await describeWrittenDocument(file.kind, written.path, written.envelope)
      } else {
        copy = await loadDocumentFile(await this.copyPackage(file, folder, naming, { id, draft: false }), this.fileDependencies(), id)
      }
      this.workspace.catalog.upsertDocument(indexedFromFile(copy, container, summarizeFile(copy, container, this.workspace)))
      return { meta: metaFromFile(copy, container), copiedFiles: 0, missingPaths: [] }
    }))
  }

  /**
   * 收养一份文档文件（4.1：导入包里解出的文档、复制进本项目）：放进目标容器的默认位置，
   * 原容器（sourceContainer，可以是解包用的临时文件夹）里被引用的素材复制过去并改写引用；
   * ID 已被占用（或要求换新）时换新 ID；去掉草稿标记。sourcePath 本身不动。
   */
  async adoptDocument(request: AdoptDocumentRequest): Promise<DocumentTransferResult> {
    return await this.logged('adopt', { container: request.destination }, async () => {
      const file = await loadDocumentFile(request.sourcePath, this.fileDependencies())
      const destination = await this.resolveContainer(request.destination)
      return await this.adoptFile(file, request.sourceContainer, destination, {
        name: request.name, onConflict: request.onConflict ?? 'keepBoth', newId: request.newId ?? 'whenTaken',
      })
    })
  }

  private async adoptFile(
    file: LoadedDocumentFile,
    source: ResolvedContainer,
    destination: ResolvedContainer,
    options: { name?: string; onConflict: 'fail' | 'keepBoth'; newId: 'always' | 'whenTaken' },
  ): Promise<DocumentTransferResult> {
    if (destination.ref.kind === 'user' && !file.kind.standaloneFolderNames) throw new DocumentLocationError('这种文档只能放在项目里。')
    const name = options.name ?? documentNameOf(file.kind, file.path)
    const naming: NamingMode = options.onConflict === 'keepBoth' ? { mode: 'keepBoth', name } : { mode: 'exact', name }
    const folder = this.workspace.defaultDocumentFolder(file.kind, destination)
    const id = options.newId === 'always' || this.workspace.catalog.getDocument(file.header.id) ? this.workspace.randomId() : file.header.id
    let copiedFiles = 0
    let missingPaths: string[] = []
    let adopted: LoadedDocumentFile
    if (file.envelope) {
      const original = file.envelope
      const decoded = await this.decode(file, source)
      const transfer = await transferContainerMedia({
        style: this.workspace.style,
        references: decoded.report.references,
        from: source,
        to: destination,
        isDocumentFile: (candidate) => Boolean(this.options.kinds.forFileName(path.basename(candidate))),
        prepareInternalFolder: (root) => this.workspace.ensureInternalFolder(root),
      })
      copiedFiles = transfer.copied
      missingPaths = transfer.missingPaths
      const content = this.validateContent(file.kind, rewriteContentPaths(decoded.content, transfer.mapping, this.workspace.style))
      const encoded = this.encode(destination, content)
      const now = this.workspace.now().toISOString()
      const written = await this.writeNewDocumentFile(folder, file.kind, (fileName) => this.withHeader(original, {
        id, name: fileName, draft: false, createdAt: now, updatedAt: now, revision: 0, kindVersion: file.kind.version, content: encoded.content,
      }), naming)
      adopted = await describeWrittenDocument(file.kind, written.path, written.envelope)
    } else {
      await fsp.mkdir(folder, { recursive: true })
      adopted = await loadDocumentFile(await this.copyPackage(file, folder, naming, { id, draft: false }), this.fileDependencies(), id)
    }
    this.workspace.catalog.upsertDocument(indexedFromFile(adopted, destination, summarizeFile(adopted, destination, this.workspace)))
    if (!isPathInside(this.workspace.style, this.workspace.layout().root, destination.root)) this.options.grantMediaRoots([destination.root])
    this.logger.info('文档已复制进容器', {
      event: 'documents.adopt.completed',
      context: { documentId: id, previousId: file.header.id, to: destination.ref, copiedFiles, missing: missingPaths.length },
    })
    return { meta: metaFromFile(adopted, destination), copiedFiles, missingPaths }
  }

  /** 移到系统回收站（“不保存”与删除都走这里，误点也能找回）。 */
  async trash(target: DocumentTarget): Promise<void> {
    await this.exclusive(target.id, async () => await this.logged('trash', { documentId: target.id }, async () => {
      const file = await this.locate(target)
      try {
        await this.options.trashItem(file.path)
      } catch (error) {
        throw new FileInUseError('文档未能移到回收站，请确认没有其他程序正在使用它。', { cause: error })
      }
      this.workspace.catalog.removeDocument(file.header.id)
      await this.options.removeCover?.(file.header.id)
    }))
  }

  /** 只删除内容为空的草稿（离开时直接丢弃）；其他情况一律移到回收站。 */
  async deleteEmptyDraft(target: DocumentTarget): Promise<void> {
    await this.exclusive(target.id, async () => await this.logged('delete_empty_draft', { documentId: target.id }, async () => {
      const file = await this.locate(target)
      if (!file.header.draft) throw new DocumentNotEmptyError('只能直接删除草稿；保存过的文档请移到回收站。')
      if (!await this.isEmpty(file)) throw new DocumentNotEmptyError()
      await fsp.rm(file.path)
      this.workspace.catalog.removeDocument(file.header.id)
      await this.options.removeCover?.(file.header.id)
    }))
  }

  /**
   * 从作品索引里移除一份找不到文件的文档（列表右键“从列表移除”，3.2 补齐 2.5 遗留）。
   * 只动索引与程序目录里的封面，不碰磁盘上的任何文件；文件还在原位置时拒绝（应该移到回收站）。
   */
  async forget(documentId: string): Promise<void> {
    await this.exclusive(documentId, async () => await this.logged('forget', { documentId }, async () => {
      const row = this.workspace.catalog.getDocument(documentId)
      if (!row) return
      const file = await this.tryLoad(row.path)
      if (file && file.header.id === documentId) {
        throw new DocumentLocationError('这份文档的文件还在，不能只从列表移除；如要删除请移到回收站。')
      }
      this.workspace.catalog.removeDocument(documentId)
      await this.options.removeCover?.(documentId)
    }))
  }

  /**
   * 收集素材：文档引用到的、不在所在容器里的文件复制进容器的“素材”文件夹并改写引用（版本加一）；
   * 引用到的、在别处（别的项目、作品目录、外部位置）的其他文档复制进容器（新 ID，4.1），
   * 内容里的 { docId, path } 跨文档引用改指向副本。
   * 打开中的会话据版本变化重新载入。没有可收集的文件与文档时不写文件、版本不变。
   */
  async collectMedia(target: DocumentTarget): Promise<DocumentTransferResult> {
    return await this.exclusive(target.id, async () => await this.logged('collect_media', { documentId: target.id }, async () => {
      const file = await this.locate(target)
      if (!file.envelope) throw new DocumentUnsupportedError('这种文档请在它自己的编辑器里收集素材。')
      const container = await this.workspace.containerForPath(file.path)
      const decoded = await this.decode(file, container)
      const documents = await this.collectLinkedDocuments(decoded.content, file.header.id, container)
      const collected = await collectContainerMedia({
        style: this.workspace.style,
        references: decoded.report.references,
        programReferences: decoded.report.programReferences,
        to: container,
        isDocumentFile: (candidate) => Boolean(this.options.kinds.forFileName(path.basename(candidate))),
      })
      if (!collected.mapping.size && !documents.links.size) return { meta: metaFromFile(file, container), copiedFiles: 0, copiedDocuments: 0, missingPaths: collected.missingPaths }
      const content = this.validateContent(file.kind, rewriteDocumentLinks(rewriteContentPaths(decoded.content, collected.mapping, this.workspace.style), documents.links))
      const encoded = this.encode(container, content)
      const envelope = this.withHeader(file.envelope, {
        name: documentNameOf(file.kind, file.path),
        kindVersion: file.kind.version,
        updatedAt: this.workspace.now().toISOString(),
        revision: file.header.revision + 1,
        content: encoded.content,
      })
      await writeBufferAtomically(file.path, this.bytes(envelope))
      const saved = await describeWrittenDocument(file.kind, file.path, envelope)
      this.workspace.catalog.upsertDocument(indexedFromFile(saved, container, file.kind.summarize(content)))
      this.logger.info('素材已收集进容器', {
        event: 'documents.collect_media.copied',
        context: { documentId: file.header.id, collected: collected.mapping.size, copiedFiles: collected.copied, copiedDocuments: documents.copied, missing: collected.missingPaths.length },
      })
      return { meta: metaFromFile(saved, container), copiedFiles: collected.copied, copiedDocuments: documents.copied, missingPaths: collected.missingPaths }
    }))
  }

  /**
   * 收集被引用的其他文档：内容里每个 { docId, path } 跨文档引用，找到的文档不在本容器里时复制进来（新 ID，
   * 原容器里它用到的素材一并复制）。同一份文档只复制一次；找不到的、就是自己的、已在容器里的不动。
   * 返回原文档 ID → 副本位置的映射。
   */
  private async collectLinkedDocuments(content: unknown, selfId: string, container: ResolvedContainer): Promise<{ links: Map<string, DocumentLink>; copied: number }> {
    const links = new Map<string, DocumentLink>()
    let copied = 0
    for (const link of findDocumentLinks(content)) {
      if (link.docId === selfId || links.has(link.docId) || !this.options.kinds.forFileName(path.basename(link.path))) continue
      const resolved = await this.resolveLink(link)
      if (resolved.status !== 'found') continue
      if (sameContainer(resolved.meta.container, container.ref)) continue
      const source = await loadDocumentFile(resolved.meta.path, this.fileDependencies(), resolved.meta.id)
      const adopted = await this.adoptFile(source, await this.workspace.containerForPath(source.path), container, { onConflict: 'keepBoth', newId: 'always' })
      links.set(link.docId, { docId: adopted.meta.id, path: adopted.meta.path })
      copied += 1
    }
    return { links, copied }
  }

  /** 把一个文件复制进容器的“生成结果”或“素材”；已在容器里的原样返回。 */
  async importFile(request: ImportFileRequest): Promise<ImportFileResult> {
    return await this.logged('import_file', { container: request.container, folder: request.folder }, async () => {
      if (!path.isAbsolute(request.sourcePath)) throw new DocumentLocationError('文件位置无效。')
      const source = path.resolve(request.sourcePath)
      const stat = await fsp.stat(source).catch(() => null)
      if (!stat?.isFile()) throw new DocumentLocationError('要放进项目的文件不存在。')
      const container = await this.resolveContainer(request.container)
      if (isPathInside(this.workspace.style, container.root, source)) return { path: source, copied: false }
      const folder = request.folder === 'generated' ? container.generatedDir : container.materialsDir
      const result = await copyKeepingBoth(source, path.join(folder, path.basename(source)))
      if (!isPathInside(this.workspace.style, this.workspace.layout().root, container.root)) this.options.grantMediaRoots([container.root])
      return result
    })
  }

  async reveal(target: DocumentTarget): Promise<void> {
    const file = await this.locate(target)
    this.options.showItemInFolder(file.path)
  }

  /** 跨文档引用：先按位置找（拷贝出来的项目引用自己的副本），找不到再按 ID 查索引。 */
  async resolveLink(link: DocumentLink): Promise<DocumentLinkResolution> {
    const byPath = await this.tryLoad(link.path)
    if (byPath) return { status: 'found', via: 'path', meta: metaFromFile(byPath, await this.workspace.containerForPath(byPath.path)) }
    const row = this.workspace.catalog.getDocument(link.docId)
    const byId = row ? await this.tryLoad(row.path) : null
    if (byId && byId.header.id === link.docId) {
      return { status: 'found', via: 'id', meta: metaFromFile(byId, await this.workspace.containerForPath(byId.path)) }
    }
    return { status: 'missing' }
  }

  async checkName(request: NameCheckRequest): Promise<NameCheckResult> {
    return await checkEntryName(request, { workspace: this.workspace, kinds: this.options.kinds })
  }

  /** 按位置 / ID 找到文档文件并读出头信息（不解码内容）；单文件包导出用。 */
  async locateFile(target: DocumentTarget): Promise<LoadedDocumentFile> {
    return await this.locate(target)
  }

  // ==================== 定位与换算 ====================

  private fileDependencies(): { kinds: DocumentKindRegistry; adapters: PackageAdapterRegistry } {
    return { kinds: this.options.kinds, adapters: this.options.adapters }
  }

  /**
   * 给了位置就先按位置找并核对 ID，找不到再按索引里的位置找；
   * 仍找不到时（文件刚在资源管理器里改名或移动，索引还没跟上）刷新索引后再找一次。
   */
  private async locate(target: DocumentTarget): Promise<LoadedDocumentFile> {
    try {
      return await this.locateOnce(target)
    } catch (error) {
      if (!(error instanceof DocumentNotFoundError) || !this.options.refreshProjects) throw error
      await this.options.refreshProjects()
      return await this.locateOnce(target)
    }
  }

  private async locateOnce(target: DocumentTarget): Promise<LoadedDocumentFile> {
    const candidates: string[] = []
    if (target.path !== undefined) {
      if (!path.isAbsolute(target.path)) throw new DocumentLocationError('文档位置无效。')
      candidates.push(path.resolve(target.path))
    }
    const row = this.workspace.catalog.getDocument(target.id)
    if (row && !candidates.some((candidate) => samePath(this.workspace.style, candidate, row.path))) candidates.push(row.path)
    for (const candidate of candidates) {
      if (!this.options.kinds.forFileName(path.basename(candidate))) continue
      try {
        const file = await loadDocumentFile(candidate, this.fileDependencies(), target.id)
        if (file.header.id === target.id) return file
      } catch (error) {
        if (error instanceof DocumentNotFoundError) continue
        throw error
      }
    }
    throw new DocumentNotFoundError(target.id)
  }

  private async tryLoad(filePath: string): Promise<LoadedDocumentFile | null> {
    if (!path.isAbsolute(filePath) || !this.options.kinds.forFileName(path.basename(filePath))) return null
    try {
      return await loadDocumentFile(filePath, this.fileDependencies())
    } catch {
      return null
    }
  }

  private async resolveContainer(ref: DocumentContainerRef): Promise<ResolvedContainer> {
    try {
      return await this.workspace.resolveContainer(ref)
    } catch (error) {
      if (!(error instanceof ProjectNotFoundError) || !this.options.refreshProjects) throw error
      // 索引可能落后于磁盘（项目刚在资源管理器里改名或拷进来）：刷新项目后重试一次。
      await this.options.refreshProjects()
      return await this.workspace.resolveContainer(ref)
    }
  }

  private async decode(file: LoadedDocumentFile, container: ResolvedContainer): Promise<DecodedDocumentContent> {
    const decoded = decodeDocumentContent(file, container, this.workspace)
    if (!this.options.refreshProjects || !decoded.report.unresolved.some((item) => item.reason === 'unknown_project')) return decoded
    // 引用了索引里还没有的项目：刷新项目后重试一次。
    await this.options.refreshProjects()
    return decodeDocumentContent(file, container, this.workspace)
  }

  private encode(container: ResolvedContainer, content: unknown): { content: unknown; report: LocationReport } {
    return createLocationCodec(this.workspace.locationContext(container)).encodeContent(content)
  }

  private validateContent(kind: DocumentKindDescriptor, content: unknown): unknown {
    const result = kind.contentSchema.safeParse(content)
    if (!result.success) {
      throw new DocumentFormatError(`文档内容无效：${result.error.issues[0]?.message ?? '格式错误'}`, { cause: result.error })
    }
    return result.data
  }

  private async isEmpty(file: LoadedDocumentFile): Promise<boolean> {
    if (!file.envelope) return await this.requireAdapter(file).isEmpty(file.path)
    const container = await this.workspace.containerForPath(file.path)
    return file.kind.isEmptyContent(decodeDocumentContent(file, container, this.workspace).content)
  }

  /** 引用里找不到的文件与外部文件所在目录。 */
  private async inspectReferences(report: LocationReport): Promise<{ missingPaths: string[]; externalDirectories: string[] }> {
    const missingPaths: string[] = []
    const directories = new Map<string, string>()
    const queue = [...report.references]
    const worker = async (): Promise<void> => {
      for (let reference = queue.shift(); reference; reference = queue.shift()) {
        const exists = await fsp.stat(reference.path).then(() => true, () => false)
        if (!exists) {
          missingPaths.push(reference.path)
          continue
        }
        if (reference.scope !== 'external') continue
        const directory = path.dirname(reference.path)
        const key = pathKey(this.workspace.style, directory)
        if (key && !directories.has(key)) directories.set(key, directory)
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFERENCE_CHECK_CONCURRENCY, queue.length) }, worker))
    return { missingPaths, externalDirectories: [...directories.values()] }
  }

  /** 授权媒体协议读取外部引用目录、引用到的外部项目与文档所在的外部项目（作品目录始终已授权）。 */
  private grantReferences(container: ResolvedContainer, report: LocationReport, externalDirectories: readonly string[]): void {
    const roots = new Set(externalDirectories)
    const userRoot = this.workspace.layout().root
    if (!isPathInside(this.workspace.style, userRoot, container.root)) roots.add(container.root)
    for (const reference of report.references) {
      if (reference.scope !== 'project' || !reference.projectId) continue
      const project = this.workspace.catalog.getProject(reference.projectId)
      if (project && !isPathInside(this.workspace.style, userRoot, project.path)) roots.add(project.path)
    }
    if (roots.size) this.options.grantMediaRoots([...roots])
  }

  private warnProgramReferences(action: string, file: LoadedDocumentFile, report: LocationReport): void {
    if (!report.programReferences.length) return
    // 画布内嵌图片的地址按内容哈希寻址，源资源随 canvas-layers 包携带，预览可从同一文档重建。
    // 这不是机器绝对路径；其他内部协议和真正的程序目录路径仍须警告。
    const managed = file.kind.id === 'canvas' ? report.programReferences.filter(value => /^henji-media:\/\/image-editor-v3\/[a-f0-9]{64}(?:\?mediaType=[^#]*)?$/.test(value)) : []
    if (managed.length) this.logger.debug('画布使用受管图片资源引用，由内嵌图片文档恢复', {
      event: 'documents.content.managed_image_references',
      context: { action, documentId: file.header.id, count: managed.length },
    })
    const references = report.programReferences.filter(value => !managed.includes(value))
    if (!references.length) return
    this.logger.warn('文档里出现程序目录的路径，换位置或拷给别人后会失效', {
      event: 'documents.content.program_references',
      context: { action, documentId: file.header.id, kind: file.kind.id, count: references.length, sample: references.slice(0, 3) },
    })
  }

  // ==================== 写入 ====================

  private bytes(envelope: DocumentEnvelope): Buffer {
    return Buffer.from(serializeDocumentEnvelope(envelope), 'utf8')
  }

  private withHeader(envelope: DocumentEnvelope, patch: Partial<Omit<DocumentEnvelope, 'format' | 'draft'>> & { draft?: boolean }): DocumentEnvelope {
    return buildDocumentEnvelope({
      kind: patch.kind ?? envelope.kind,
      kindVersion: patch.kindVersion ?? envelope.kindVersion,
      id: patch.id ?? envelope.id,
      name: patch.name ?? envelope.name,
      createdAt: patch.createdAt ?? envelope.createdAt,
      updatedAt: patch.updatedAt ?? envelope.updatedAt,
      revision: patch.revision ?? envelope.revision,
      draft: patch.draft ?? envelope.draft === true,
      content: patch.content === undefined ? envelope.content : patch.content,
    })
  }

  private async pickTarget(folder: string, extension: string, naming: NamingMode): Promise<{ name: string; path: string }> {
    const taken = await readEntryNameKeys(folder)
    const isTaken = (name: string): boolean => taken.has(entryNameKey(`${name}${extension}`))
    let name: string
    if (naming.mode === 'untitled') name = untitledEntryName(naming.base, isTaken)
    else if (naming.mode === 'keepBoth') name = keepBothEntryName(naming.name, isTaken)
    else {
      name = naming.name
      const existing = taken.get(entryNameKey(`${name}${extension}`))
      if (existing !== undefined) throw new DocumentNameConflictError(path.join(folder, existing))
    }
    return { name, path: path.join(folder, `${name}${extension}`) }
  }

  /**
   * 以不覆盖的方式写一份新文档文件。exact：用户输入的名字，重名报错；keepBoth：重名时加序号；
   * untitled：自动名顺延。检查与写入之间被抢先时按同样的规则重来（exact 直接报重名）。
   */
  private async writeNewDocumentFile(
    folder: string,
    kind: DocumentKindDescriptor,
    build: (name: string) => DocumentEnvelope,
    naming: NamingMode,
  ): Promise<{ path: string; envelope: DocumentEnvelope }> {
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const target = await this.pickTarget(folder, kind.extension, naming)
      const envelope = build(target.name)
      try {
        await createFileExclusively(target.path, this.bytes(envelope))
        return { path: target.path, envelope }
      } catch (error) {
        if (!(error instanceof EntryExistsError)) throw error
        if (naming.mode === 'exact') throw new DocumentNameConflictError(error.path)
      }
    }
    throw new Error('同名文件过多，请先整理文件夹。')
  }

  /** 原文件夹内改名 / 改头信息（改名、转正）：不改内容、不加版本。 */
  private async rewriteInPlace(
    file: LoadedDocumentFile,
    target: string,
    header: { name: string; draft: boolean },
    container: ResolvedContainer,
  ): Promise<LoadedDocumentFile> {
    let updated: LoadedDocumentFile
    if (file.envelope) {
      const envelope = this.withHeader(file.envelope, { name: header.name, draft: header.draft, updatedAt: this.workspace.now().toISOString() })
      if (samePath(this.workspace.style, file.path, target)) {
        // 同一位置（只改大小写或原地转正）：原子替换后再改名。
        await writeBufferAtomically(file.path, this.bytes(envelope))
        if (file.path !== target) await fsp.rename(file.path, target)
      } else {
        try {
          await createFileExclusively(target, this.bytes(envelope))
        } catch (error) {
          if (error instanceof EntryExistsError) throw new DocumentNameConflictError(error.path)
          throw error
        }
        await this.removeOriginal(file.path, target)
      }
      updated = await describeWrittenDocument(file.kind, target, envelope)
    } else {
      await this.movePackage(file, target, { name: header.name, draft: header.draft })
      updated = await loadDocumentFile(target, this.fileDependencies(), file.header.id)
    }
    this.workspace.catalog.upsertDocument(indexedFromFile(updated, container, summarizeFile(updated, container, this.workspace)))
    return updated
  }

  /** 新文件已发布后删除原文件；删不掉时撤掉新文件，保持“只有一份”。 */
  private async removeOriginal(original: string, published: string): Promise<void> {
    try {
      await fsp.rm(original)
    } catch (error) {
      await fsp.rm(published, { force: true }).catch(() => undefined)
      if (isInUseError(error)) throw new FileInUseError(undefined, { cause: error })
      throw error
    }
  }

  private requireAdapter(file: LoadedDocumentFile): PackageDocumentAdapter {
    const adapter = this.options.adapters.get(file.kind.id)
    if (!adapter) throw new DocumentUnsupportedError('这种文档的读写尚未接入。')
    return adapter
  }

  /** 包类型：先不覆盖地移动文件，再由适配器改写头信息；改写失败时移回原处。 */
  private async movePackage(file: LoadedDocumentFile, target: string, patch: PackageDocumentHeaderPatch): Promise<void> {
    const adapter = this.requireAdapter(file)
    if (file.path !== target) {
      try {
        await moveFileNoOverwrite(file.path, target)
      } catch (error) {
        if (error instanceof EntryExistsError) throw new DocumentNameConflictError(error.path)
        if (isInUseError(error)) throw new FileInUseError(undefined, { cause: error })
        throw error
      }
    }
    try {
      await adapter.writeHeader(target, patch)
    } catch (error) {
      if (file.path !== target) await moveFileNoOverwrite(target, file.path).catch(() => undefined)
      throw error
    }
  }

  private async copyPackage(
    file: LoadedDocumentFile,
    folder: string,
    naming: NamingMode,
    patch: PackageDocumentHeaderPatch,
  ): Promise<string> {
    const adapter = this.requireAdapter(file)
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const target = await this.pickTarget(folder, file.kind.extension, naming)
      try {
        await copyFileNoOverwrite(file.path, target.path)
      } catch (error) {
        if (!(error instanceof EntryExistsError)) throw error
        if (naming.mode === 'exact') throw new DocumentNameConflictError(error.path)
        continue
      }
      try {
        await adapter.writeHeader(target.path, { ...patch, name: target.name })
      } catch (error) {
        await fsp.rm(target.path, { force: true }).catch(() => undefined)
        throw error
      }
      return target.path
    }
    throw new Error('同名文件过多，请先整理文件夹。')
  }

  private async movePackageTo(file: LoadedDocumentFile, folder: string, options: RelocateOptions): Promise<string> {
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const target = await this.pickTarget(folder, file.kind.extension, options.naming)
      try {
        await this.movePackage(file, target.path, { name: target.name, draft: options.draft })
        return target.path
      } catch (error) {
        if (!(error instanceof DocumentNameConflictError) || options.naming.mode === 'exact') throw error
      }
    }
    throw new Error('同名文件过多，请先整理文件夹。')
  }

  /**
   * 换文件夹（移动、另存位置）：容器变化时把原容器里用到的素材复制过去并改写引用，
   * 再以不覆盖的方式写到新位置、删除原文件。
   */
  private async relocate(file: LoadedDocumentFile, folder: string, options: RelocateOptions): Promise<DocumentTransferResult> {
    const source = await this.workspace.containerForPath(file.path)
    const destination = options.destination ?? await this.workspace.containerForFolder(folder)
    if (destination.ref.kind === 'user' && !file.kind.standaloneFolderNames) throw new DocumentLocationError('这种文档只能放在项目里。')
    let copiedFiles = 0
    let missingPaths: string[] = []
    let moved: LoadedDocumentFile
    if (file.envelope) {
      const original = file.envelope
      const decoded = await this.decode(file, source)
      let content = decoded.content
      let rewritten = false
      if (!sameContainer(source.ref, destination.ref)) {
        const transfer = await transferContainerMedia({
          style: this.workspace.style,
          references: decoded.report.references,
          from: source,
          to: destination,
          isDocumentFile: (candidate) => Boolean(this.options.kinds.forFileName(path.basename(candidate))),
          prepareInternalFolder: (root) => this.workspace.ensureInternalFolder(root),
        })
        content = rewriteContentPaths(content, transfer.mapping, this.workspace.style)
        rewritten = transfer.mapping.size > 0
        copiedFiles = transfer.copied
        missingPaths = transfer.missingPaths
      }
      const encoded = this.encode(destination, content)
      const updatedAt = this.workspace.now().toISOString()
      const revision = rewritten ? file.header.revision + 1 : file.header.revision
      const written = await this.writeNewDocumentFile(folder, file.kind, (name) => this.withHeader(original, {
        name, draft: options.draft, updatedAt, revision, kindVersion: file.kind.version, content: encoded.content,
      }), options.naming)
      await this.removeOriginal(file.path, written.path)
      moved = await describeWrittenDocument(file.kind, written.path, written.envelope)
    } else {
      moved = await loadDocumentFile(await this.movePackageTo(file, folder, options), this.fileDependencies(), file.header.id)
    }
    this.workspace.catalog.upsertDocument(indexedFromFile(moved, destination, summarizeFile(moved, destination, this.workspace)))
    if (options.registerExternal) await this.registerLocation(folder, destination)
    if (!isPathInside(this.workspace.style, this.workspace.layout().root, destination.root)) this.options.grantMediaRoots([destination.root])
    this.logger.info('文档已换位置', {
      event: 'documents.relocate.completed',
      context: { documentId: file.header.id, from: source.ref, to: destination.ref, copiedFiles, missing: missingPaths.length },
    })
    return { meta: metaFromFile(moved, destination), copiedFiles, missingPaths }
  }

  /** 另存到扫描范围之外时登记为外部位置，照样出现在列表里。 */
  private async registerLocation(folder: string, destination: ResolvedContainer): Promise<void> {
    const catalog = this.workspace.catalog
    if (destination.ref.kind === 'project' && destination.manifest) {
      if (catalog.getProject(destination.ref.projectId)) return
      const project = await this.workspace.describeProject(destination.root, destination.manifest)
      catalog.upsertProject(project)
      if (project.external) catalog.addExternalLocation(destination.root, 'project')
      return
    }
    if (!this.workspace.isScannedDocumentFolder(folder)) catalog.addExternalLocation(folder, 'folder')
  }

  // ==================== 串行与日志 ====================

  private async exclusive<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    return await this.executor.run(documentId, async () => await withFileLock(
      path.join(this.options.lockDirectory, `${documentId}.lock`),
      operation,
      { timeoutMessage: '文档正被另一个窗口或助手写入，请稍后重试。' },
    ))
  }

  private logFailure(action: string, context: Record<string, unknown>, error: unknown): void {
    const expected = EXPECTED_FAILURES.some((type) => error instanceof type)
    this.logger[expected ? 'warn' : 'error']('文档操作失败', { event: `documents.${action}.failed`, context, error })
  }

  private async logged<T>(action: string, context: Record<string, unknown>, operation: () => Promise<T>): Promise<T> {
    this.logger.info('开始处理文档', { event: `documents.${action}.start`, context })
    try {
      const result = await operation()
      this.logger.info('文档处理完成', { event: `documents.${action}.completed`, context })
      return result
    } catch (error) {
      this.logFailure(action, context, error)
      throw error
    }
  }
}
