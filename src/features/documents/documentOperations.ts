import * as documentCommands from '@/commands/documents'
import { documentKindRegistry, type DocumentKindRegistry } from '@/core/documents/kinds'
import type {
  DocumentContainerRef,
  DocumentIndexScanReport,
  DocumentKindId,
  DocumentListQuery,
  DocumentMeta,
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
  MoveDocumentRequest,
  NameCheckResult,
  NameConflictPolicy,
  ProjectListQuery,
  ProjectSummary,
  RenameDocumentRequest,
  RenameProjectRequest,
} from '@/core/documents/types'
import { createLogger, type Logger } from '@/core/logging/logger'

import { isDocumentServiceError, toError } from './documentErrors'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from './documentSessionRegistry'
import type { DocumentSessionCommands } from './documentSessionTypes'

/*
 * 通用文档操作（存储底座 2.5）：项目页卡片右键与智能助手共用的唯一领域服务。
 *
 * - 列表、重命名、移到项目 / 移出项目、创建副本、在文件夹中显示、移到回收站、新建、打开、项目列表与新建项目。
 * - 正在编辑的文档（文档会话已打开）：改名、移动、复制前先写完最后一次；改名与移动后让会话按新位置重新定位；
 *   正在编辑的文档不能移到回收站（与遗留草稿的规则相同）。
 * - 每次写入推进本服务的版本号并通知订阅者：页面据此刷新，助手的 `documents` 作用域也取这个数。
 * - 打开方式由各工具登记（`registerDocumentOpener`，3.x 接入时登记）；没有登记的类型打开时报
 *   DocumentNotOpenableError，说明该类型还不能从通用入口打开。
 * - 后台释放由各工具登记（`registerDocumentReleaser`，3.2 补）：工具可能为助手的后台读写持有会话
 *   （没有界面在用），移到回收站前先请工具释放；界面正在编辑或有进行中的任务时工具拒绝，照旧报正在编辑。
 * - 找不到文件的文档可以“从列表移除”（`forgetDocument`，3.2 补齐 2.5 遗留），只改作品索引。
 */

/** 通用操作用到的文档命令；正式运行用 `@/commands/documents`，测试换成替身。 */
export interface DocumentOperationCommands extends DocumentSessionCommands {
  renameDocument(request: RenameDocumentRequest): Promise<DocumentMeta>
  moveDocument(request: MoveDocumentRequest): Promise<DocumentTransferResult>
  duplicateDocument(request: DuplicateDocumentRequest): Promise<DocumentTransferResult>
  revealDocument(target: DocumentTarget): Promise<void>
  forgetDocument(docId: string): Promise<void>
  refreshIndex(): Promise<DocumentIndexScanReport>
  renameProject(request: RenameProjectRequest): Promise<ProjectSummary>
  revealProject(projectId: string): Promise<void>
}

/** 打开一份文档（进入对应工具的编辑界面）。由各工具在接入通用文档时登记。 */
export type DocumentOpener = (document: DocumentSummary) => Promise<void> | void

/**
 * 释放工具在后台持有的文档会话（界面没有在编辑、没有进行中的任务时写完并关闭）。
 * 返回 true 表示会话已关闭；返回 false 表示仍在使用，不能释放。
 */
export type DocumentReleaser = (documentId: string) => Promise<boolean>

/** 正在编辑的文档不能移到回收站。 */
export class DocumentInUseError extends Error {
  constructor(name: string) {
    super(`“${name}”正在编辑，请先关闭后再移到回收站。`)
    this.name = 'DocumentInUseError'
  }
}

/** 该类型还没有登记通用打开方式（对应工具尚未接入通用文档）。 */
export class DocumentNotOpenableError extends Error {
  constructor(kind: DocumentKindId) {
    super(`这种文档（${kind}）还不能从通用入口打开，请在对应工具的页面里打开。`)
    this.name = 'DocumentNotOpenableError'
  }
}

/** 剪辑等只能放在项目里的类型不能移出项目。 */
export class DocumentStandaloneNotAllowedError extends Error {
  constructor(kind: DocumentKindId) {
    super(`这种文档（${kind}）只能放在项目里，不能移出项目。`)
    this.name = 'DocumentStandaloneNotAllowedError'
  }
}

export interface DocumentOperationsOptions {
  commands?: DocumentOperationCommands
  /** 文档会话登记表；省略时取应用唯一的那一个（第一次用到时才创建）。 */
  registry?: DocumentSessionRegistry
  kinds?: Pick<DocumentKindRegistry, 'require'>
  logger?: Logger
}

export interface CreateNamedDocumentRequest {
  kind: DocumentKindId
  container: DocumentContainerRef
  name: string
}

export const defaultDocumentOperationCommands: DocumentOperationCommands = {
  readDocument: documentCommands.readDocument,
  createDocument: documentCommands.createDocument,
  saveDocument: documentCommands.saveDocument,
  finalizeDocument: documentCommands.finalizeDocument,
  trashDocument: documentCommands.trashDocument,
  deleteEmptyDraft: documentCommands.deleteEmptyDraft,
  listDocuments: documentCommands.listDocuments,
  checkName: documentCommands.checkDocumentName,
  createProject: documentCommands.createProject,
  finalizeProject: documentCommands.finalizeProject,
  trashProject: documentCommands.trashProject,
  listProjects: documentCommands.listProjects,
  renameDocument: documentCommands.renameDocument,
  moveDocument: documentCommands.moveDocument,
  duplicateDocument: documentCommands.duplicateDocument,
  revealDocument: documentCommands.revealDocument,
  forgetDocument: documentCommands.forgetDocument,
  refreshIndex: documentCommands.refreshDocumentIndex,
  renameProject: documentCommands.renameProject,
  revealProject: documentCommands.revealProject,
}

/** 名称重名错误（主进程报 DocumentNameConflictError）：移动、复制时据此询问“两个都保留”。 */
export function isDocumentNameConflict(error: unknown): boolean {
  return isDocumentServiceError(error, 'DocumentNameConflictError')
}

export class DocumentOperations {
  private readonly commands: DocumentOperationCommands
  private readonly providedRegistry: DocumentSessionRegistry | undefined
  private readonly kinds: Pick<DocumentKindRegistry, 'require'>
  private readonly logger: Logger
  private readonly openers = new Map<DocumentKindId, DocumentOpener>()
  private readonly releasers = new Map<DocumentKindId, DocumentReleaser>()
  private readonly listeners = new Set<() => void>()
  private currentRevision = 0

  constructor(options: DocumentOperationsOptions = {}) {
    this.commands = options.commands ?? defaultDocumentOperationCommands
    this.providedRegistry = options.registry
    this.kinds = options.kinds ?? documentKindRegistry
    this.logger = options.logger ?? createLogger('features.documents.operations')
  }

  /** 每次写入（改名、移动、副本、回收站、新建）加一；页面刷新与助手并发基线共用。 */
  revision(): number {
    return this.currentRevision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 登记某类文档的打开方式；返回取消登记函数。同一类型只保留最后登记的那个。 */
  registerOpener(kind: DocumentKindId, opener: DocumentOpener): () => void {
    this.openers.set(kind, opener)
    return () => {
      if (this.openers.get(kind) === opener) this.openers.delete(kind)
    }
  }

  /** 登记某类文档的后台释放方式；返回取消登记函数。同一类型只保留最后登记的那个。 */
  registerReleaser(kind: DocumentKindId, releaser: DocumentReleaser): () => void {
    this.releasers.set(kind, releaser)
    return () => {
      if (this.releasers.get(kind) === releaser) this.releasers.delete(kind)
    }
  }

  canOpen(kind: DocumentKindId): boolean {
    return this.openers.has(kind)
  }

  /** 该类型能否独立存放（不在任何项目里）；不能的类型没有“移出项目”。 */
  canStandalone(kind: DocumentKindId): boolean {
    return this.kinds.require(kind).standaloneFolderNames !== null
  }

  async listDocuments(query: DocumentListQuery = {}): Promise<DocumentSummary[]> {
    return await this.commands.listDocuments(query)
  }

  async listProjects(query: ProjectListQuery = {}): Promise<ProjectSummary[]> {
    return await this.commands.listProjects(query)
  }

  /** 扫描作品目录与外部位置；扫描有变化时通知订阅者刷新。 */
  async refreshIndex(): Promise<DocumentIndexScanReport> {
    const report = await this.commands.refreshIndex()
    this.logger.debug('作品索引已刷新', { event: 'documents.operations.refresh.completed', context: { ...report } })
    if (report.readDocuments > 0 || report.moved > 0 || report.missing > 0 || report.reassignedIds > 0) this.changed()
    return report
  }

  /** 找到一份文档的列表摘要（含缺失）；找不到时报 DocumentNotFoundError。 */
  async findDocument(id: string): Promise<DocumentSummary> {
    const found = (await this.commands.listDocuments({ container: { kind: 'any' }, includeDrafts: true, includeMissing: true }))
      .find((document) => document.id === id)
    if (!found) {
      const error = new Error('找不到这份文档，请重新列出文档后再试。')
      error.name = 'DocumentNotFoundError'
      throw error
    }
    return found
  }

  async findProject(id: string): Promise<ProjectSummary> {
    const found = (await this.commands.listProjects({ includeDrafts: true, includeMissing: true })).find((project) => project.id === id)
    if (!found) {
      const error = new Error('找不到这个项目，请重新列出项目后再试。')
      error.name = 'ProjectNotFoundError'
      throw error
    }
    return found
  }

  /** 改名前的实时检查：同一文件夹里同类型查重，排除自己。 */
  async checkDocumentName(document: Pick<DocumentSummary, 'kind' | 'path'>, name: string): Promise<NameCheckResult> {
    return await this.commands.checkName({ subject: { type: 'document', kind: document.kind }, name, location: { renaming: document.path } })
  }

  /** 新建文档前的检查：容器里该类型的默认位置。 */
  async checkNewDocumentName(kind: DocumentKindId, container: DocumentContainerRef, name: string): Promise<NameCheckResult> {
    return await this.commands.checkName({ subject: { type: 'document', kind }, name, location: { container } })
  }

  /** 新建项目前的检查：作品目录“项目”文件夹里查同名文件夹。 */
  async checkNewProjectName(name: string): Promise<NameCheckResult> {
    return await this.commands.checkName({ subject: { type: 'project' }, name, location: { container: { kind: 'user' } } })
  }

  async checkProjectRename(project: Pick<ProjectSummary, 'path'>, name: string): Promise<NameCheckResult> {
    return await this.commands.checkName({ subject: { type: 'project' }, name, location: { renaming: project.path } })
  }

  /** 重命名；用户输入的名字重名时报 DocumentNameConflictError，不加后缀。 */
  async renameDocument(target: DocumentTarget, name: string): Promise<DocumentMeta> {
    return await this.write('rename', target.id, async () => {
      const session = this.registry().get(target.id)
      if (session) await session.flush()
      const meta = await this.commands.renameDocument({ target: session?.target ?? target, name })
      if (session && !session.isEnded) await session.relocate()
      return meta
    })
  }

  /** 移到项目 / 移出项目（container 为 user）。重名按 onConflict：fail 报错，keepBoth 自动加序号。 */
  async moveDocument(target: DocumentTarget, container: DocumentContainerRef, onConflict: NameConflictPolicy = 'fail'): Promise<DocumentTransferResult> {
    return await this.write('move', target.id, async () => {
      const session = this.registry().get(target.id)
      if (container.kind === 'user') {
        const kind = session?.documentMeta.kind ?? (await this.findDocument(target.id)).kind
        if (!this.canStandalone(kind)) throw new DocumentStandaloneNotAllowedError(kind)
      }
      if (session) await session.flush()
      const result = await this.commands.moveDocument({ target: session?.target ?? target, container, onConflict })
      if (session && !session.isEnded) await session.applyTransfer(result)
      return result
    })
  }

  /** 创建副本：与原件在同一文件夹，沿用原名，重名时按 onConflict（默认两个都保留，自动加序号）。 */
  async duplicateDocument(target: DocumentTarget, onConflict: NameConflictPolicy = 'keepBoth'): Promise<DocumentTransferResult> {
    return await this.write('duplicate', target.id, async () => {
      const session = this.registry().get(target.id)
      if (session) await session.flush()
      return await this.commands.duplicateDocument({ target: session?.target ?? target, onConflict })
    })
  }

  /**
   * 移到系统回收站（可以从回收站找回）。正在编辑的文档拒绝；只是被工具在后台持有的，先请工具释放再删。
   */
  async trashDocument(target: DocumentTarget & { name?: string }): Promise<void> {
    await this.write('trash', target.id, async () => {
      const session = this.registry().get(target.id)
      if (session && !await this.release(session.documentMeta.kind, target.id)) throw new DocumentInUseError(session.documentMeta.name)
      await this.commands.trashDocument({ id: target.id, ...(target.path ? { path: target.path } : {}) })
    })
  }

  /** 从列表移除找不到文件的文档（只改作品索引，不动磁盘）；文件还在时主进程报 DocumentLocationError。 */
  async forgetDocument(id: string): Promise<void> {
    await this.write('forget', id, async () => {
      await this.commands.forgetDocument(id)
    })
  }

  async revealDocument(target: DocumentTarget): Promise<void> {
    await this.commands.revealDocument(target)
  }

  /** 新建一份已命名（非草稿）的文档，不打开。重名报错。 */
  async createDocument(request: CreateNamedDocumentRequest): Promise<DocumentMeta> {
    return await this.write('create', request.kind, async () => {
      const read = await this.commands.createDocument({ kind: request.kind, container: request.container, name: request.name, draft: false })
      return read.meta
    })
  }

  /** 打开文档：交给该类型登记的打开方式（与页面打开是同一入口）。 */
  async openDocument(document: DocumentSummary): Promise<void> {
    const opener = this.openers.get(document.kind)
    if (!opener) throw new DocumentNotOpenableError(document.kind)
    await opener(document)
    this.logger.info('打开文档', { event: 'documents.operations.open.completed', context: { docId: document.id, kind: document.kind } })
  }

  /** 新建一个已命名的项目（不是草稿）。重名报错。 */
  async createProject(name: string): Promise<ProjectSummary> {
    return await this.write('create_project', name, async () => await this.commands.createProject({ name, draft: false }))
  }

  async renameProject(projectId: string, name: string): Promise<ProjectSummary> {
    return await this.write('rename_project', projectId, async () => {
      const project = await this.commands.renameProject({ projectId, name })
      // 项目改名后其中已打开的文档路径变了，按 ID 重新定位
      for (const session of this.registry().list()) {
        const container = session.documentMeta.container
        if (container.kind === 'project' && container.projectId === projectId && !session.isEnded) await session.relocate()
      }
      return project
    })
  }

  async revealProject(projectId: string): Promise<void> {
    await this.commands.revealProject(projectId)
  }

  /** 请工具释放后台持有的会话；没有登记释放方式或释放失败时按“仍在使用”处理。 */
  private async release(kind: DocumentKindId, id: string): Promise<boolean> {
    const releaser = this.releasers.get(kind)
    if (!releaser) return false
    try {
      return await releaser(id) && !this.registry().get(id)
    } catch (error) {
      this.logger.warn('释放文档会话失败', { event: 'documents.operations.release.failed', error: toError(error), context: { docId: id, kind } })
      return false
    }
  }

  private registry(): DocumentSessionRegistry {
    return this.providedRegistry ?? getDocumentSessionRegistry()
  }

  private async write<T>(action: string, subjectId: string, run: () => Promise<T>): Promise<T> {
    const event = `documents.operations.${action}`
    this.logger.info('文档操作开始', { event: `${event}.start`, context: { subjectId } })
    try {
      const result = await run()
      this.logger.info('文档操作完成', { event: `${event}.completed`, context: { subjectId } })
      this.changed()
      return result
    } catch (raw) {
      const error = toError(raw)
      // 重名、正在编辑这类用户可处理的失败记 warn
      const expected = ['DocumentNameConflictError', 'DocumentNameInvalidError', 'DocumentInUseError', 'DocumentStandaloneNotAllowedError'].includes(error.name)
      this.logger[expected ? 'warn' : 'error']('文档操作失败', { event: `${event}.failed`, error, context: { subjectId } })
      throw error
    }
  }

  private changed(): void {
    this.currentRevision += 1
    for (const listener of [...this.listeners]) listener()
  }
}

let defaultOperations: DocumentOperations | null = null

/** 应用里唯一的通用文档操作服务（页面与助手共用）。 */
export function getDocumentOperations(): DocumentOperations {
  if (!defaultOperations) defaultOperations = new DocumentOperations()
  return defaultOperations
}

/** 登记某类文档的打开方式（各工具接入通用文档时调用）。 */
export function registerDocumentOpener(kind: DocumentKindId, opener: DocumentOpener): () => void {
  return getDocumentOperations().registerOpener(kind, opener)
}

/** 登记某类文档的后台释放方式（工具会为助手后台读写持有会话时调用）。 */
export function registerDocumentReleaser(kind: DocumentKindId, releaser: DocumentReleaser): () => void {
  return getDocumentOperations().registerReleaser(kind, releaser)
}
