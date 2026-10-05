import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import * as documentCommands from '@/commands/documents'
import { documentKindRegistry, type DocumentKindRegistry } from '@/core/documents/kinds'
import type {
  CreateDocumentRequest,
  DocumentContainerFilter,
  DocumentKindId,
  DocumentReadResult,
  DocumentSummary,
  DocumentTarget,
  NameCheckResult,
  ProjectSummary,
} from '@/core/documents/types'
import { createLogger, type Logger } from '@/core/logging/logger'

import { isDocumentServiceError, toError } from './documentErrors'
import { resolveDocumentPersistence } from './documentPersistence'
import { dialogDocumentSessionPrompter } from './documentPromptStore'
import { DEFAULT_DOCUMENT_SESSION_TIMING, DocumentSession, type DocumentSessionTiming } from './documentSession'
import type {
  DocumentLeaveOutcome,
  DocumentPersistence,
  DocumentSessionCommands,
  DocumentSessionPrompter,
} from './documentSessionTypes'

/*
 * 文档会话登记表（存储底座 2.4）：同一文档全局只有一个会话；草稿离开流程、项目草稿离开、
 * 遗留草稿查询与应用退出屏障都在这里。界面与助手只经这里打开 / 新建 / 离开文档。
 */

export interface DocumentSessionRegistryOptions {
  commands?: DocumentSessionCommands
  kinds?: Pick<DocumentKindRegistry, 'require'>
  prompter?: DocumentSessionPrompter
  timing?: Partial<DocumentSessionTiming>
  logger?: Logger
}

export interface OpenDocumentOptions {
  /** 单文件包类型必须提供（3.5，打开与新建也由它读写）；JSON 类型省略即可。 */
  persistence?: DocumentPersistence
}

export interface LeaveDocumentOptions {
  /**
   * 还有后台任务在写这份文档（如画布上正在生成）：照常处理草稿（保存 / 不保存 / 取消），
   * 写完当前修改但不结束会话，由工具在任务结束后自己关闭。“不保存”仍会移到回收站并结束会话。
   */
  keepOpen?: boolean
}

/** 离开草稿项目时由调用方提供：项目里有没有内容（文档都是空草稿或没有文档即为空）。 */
export interface LeaveProjectRequest {
  project: ProjectSummary
  isEmpty: boolean
}

export interface LeftoverDraftQuery {
  kind: DocumentKindId
  container?: DocumentContainerFilter
}

const defaultCommands: DocumentSessionCommands = {
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
}

/** 路径所在的文件夹（Windows 与 POSIX 分隔符都认）。 */
export function parentFolderOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index < 0) return trimmed
  // 盘符根（C:\）与 POSIX 根保留分隔符
  if (index === 0) return trimmed.slice(0, 1)
  if (index === 2 && trimmed[1] === ':') return trimmed.slice(0, 3)
  return trimmed.slice(0, index)
}

export class DocumentSessionRegistry {
  private readonly sessions = new Map<string, DocumentSession>()
  private readonly opening = new Map<string, Promise<DocumentSession>>()
  private readonly listeners = new Set<() => void>()
  private readonly commands: DocumentSessionCommands
  private readonly kinds: Pick<DocumentKindRegistry, 'require'>
  private readonly prompter: DocumentSessionPrompter
  private readonly timing: DocumentSessionTiming
  private readonly logger: Logger

  constructor(options: DocumentSessionRegistryOptions = {}) {
    this.commands = options.commands ?? defaultCommands
    this.kinds = options.kinds ?? documentKindRegistry
    this.prompter = options.prompter ?? dialogDocumentSessionPrompter
    this.timing = { ...DEFAULT_DOCUMENT_SESSION_TIMING, ...options.timing }
    this.logger = options.logger ?? createLogger('features.documents.session')
  }

  get(id: string): DocumentSession | undefined {
    return this.sessions.get(id)
  }

  list(): DocumentSession[] {
    return [...this.sessions.values()]
  }

  /** 打开会话增减时通知（如项目页刷新“遗留草稿”时排除已打开的）。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 打开文档；已打开时返回同一个会话。 */
  async open(target: DocumentTarget, options: OpenDocumentOptions = {}): Promise<DocumentSession> {
    const existing = this.sessions.get(target.id)
    if (existing) return existing
    const pending = this.opening.get(target.id)
    if (pending) return await pending
    const operation = (async () => {
      const read = options.persistence?.read
        ? await options.persistence.read(target, 'open')
        : await this.commands.readDocument(target)
      return this.adopt(read, options)
    })()
    this.opening.set(target.id, operation)
    try {
      return await operation
    } catch (error) {
      this.logger.warn('打开文档失败', { event: 'documents.session.open.failed', error: toError(error), context: { docId: target.id } })
      throw error
    } finally {
      this.opening.delete(target.id)
    }
  }

  /** 新建文档：省略名称时得到草稿（以 draft 标记立即写进最终所在的文件夹）。 */
  async create(request: CreateDocumentRequest, options: OpenDocumentOptions = {}): Promise<DocumentSession> {
    const read = options.persistence?.create
      ? await options.persistence.create(request)
      : await this.commands.createDocument(request)
    this.logger.info('新建文档', { event: 'documents.session.create.completed', context: { docId: read.meta.id, kind: read.meta.kind, draft: read.meta.draft } })
    return this.adopt(read, options)
  }

  /** 新建项目：省略名称时为草稿项目。离开时用 leaveProject。 */
  async createProject(name?: string): Promise<ProjectSummary> {
    return await this.commands.createProject(name === undefined ? undefined : { name })
  }

  /**
   * 离开文档（关闭、返回列表、切换文档）：
   * - 已保存过的文档：等最后一次保存完成后关闭，不询问。
   * - 空草稿：直接删除。
   * - 有内容的草稿：询问“保存 / 不保存 / 取消”。保存进入起名对话框；不保存移到回收站；取消留在原处。
   * 失败时抛错，会话保持打开、修改保留。
   */
  async leave(id: string, options: LeaveDocumentOptions = {}): Promise<DocumentLeaveOutcome> {
    const session = this.sessions.get(id)
    if (!session) return 'closed'
    const finish = async (): Promise<void> => {
      // keepOpen：还有后台任务在用这份文档，只做草稿决定与写完，不结束会话（由工具在空闲后关闭）
      if (options.keepOpen) await session.flush()
      else await session.close()
    }
    if (!session.documentMeta.draft) {
      await finish()
      return 'closed'
    }
    if (session.isEmpty() && await this.deleteEmptyDraft(session)) return 'discarded'

    const choice = await this.prompter.chooseLeaveAction({ subject: 'document', name: session.documentMeta.name })
    this.logger.info('草稿离开选择', { event: 'documents.session.leave.choice', context: { docId: id, choice } })
    if (choice === 'cancel') return 'cancelled'
    if (choice === 'discard') {
      await this.trashDraft(session)
      return 'discarded'
    }
    if (!await this.promptFinalize(session)) return 'cancelled'
    await finish()
    return 'saved'
  }

  /**
   * 编辑器里的“保存”：草稿弹起名对话框（可更改位置），起名后转正并写回；已保存的文档直接写回。
   * 返回 false 表示用户取消了起名。失败时抛错，修改保留。
   */
  async save(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) return false
    if (session.documentMeta.draft && !await this.promptFinalize(session)) return false
    await session.commit('save')
    return true
  }

  /** 起名并转正（离开时“保存”与编辑器里保存草稿共用）；用户取消返回 false。 */
  private async promptFinalize(session: DocumentSession): Promise<boolean> {
    const id = session.id
    return await this.prompter.askSaveName({
      subject: { type: 'document', kind: session.kind.id },
      initialName: session.documentMeta.name,
      defaultFolder: parentFolderOf(session.documentMeta.path),
      check: (name, folder) => this.checkDocumentSaveName(session, name, folder),
      submit: async (name, folder) => {
        await session.flush()
        const result = await this.commands.finalizeDocument({
          target: session.target,
          name,
          ...(folder ? { folder } : {}),
        })
        await session.applyTransfer(result)
        this.logger.info('草稿已保存', { event: 'documents.session.finalize.completed', context: { docId: id, movedFolder: Boolean(folder), copiedFiles: result.copiedFiles } })
      },
    })
  }

  /**
   * 离开草稿项目：已保存的项目不询问；空项目直接移到回收站；有内容询问“保存 / 不保存 / 取消”。
   * 保存时可另选父文件夹（整个项目文件夹移过去）。项目里已打开的文档由本函数一并处理。
   */
  async leaveProject(request: LeaveProjectRequest): Promise<DocumentLeaveOutcome> {
    const { project } = request
    const sessions = this.list().filter((session) => {
      const container = session.documentMeta.container
      return container.kind === 'project' && container.projectId === project.id
    })
    if (!project.draft) {
      for (const session of sessions) await session.close()
      return 'closed'
    }
    if (request.isEmpty) {
      await this.trashProject(project, sessions)
      return 'discarded'
    }
    const choice = await this.prompter.chooseLeaveAction({ subject: 'project', name: project.name })
    this.logger.info('草稿项目离开选择', { event: 'documents.session.leave_project.choice', context: { projectId: project.id, choice } })
    if (choice === 'cancel') return 'cancelled'
    if (choice === 'discard') {
      await this.trashProject(project, sessions)
      return 'discarded'
    }
    const saved = await this.prompter.askSaveName({
      subject: { type: 'project' },
      initialName: project.name,
      defaultFolder: parentFolderOf(project.path),
      check: (name, folder) => this.commands.checkName({
        subject: { type: 'project' },
        name,
        location: folder ? { folder } : { renaming: project.path },
      }),
      submit: async (name, folder) => {
        for (const session of sessions) await session.flush()
        await this.commands.finalizeProject({ projectId: project.id, name, ...(folder ? { parentFolder: folder } : {}) })
        for (const session of sessions) await session.relocate()
        this.logger.info('草稿项目已保存', { event: 'documents.session.finalize_project.completed', context: { projectId: project.id, movedFolder: Boolean(folder) } })
      },
    })
    if (!saved) return 'cancelled'
    for (const session of sessions) await session.close()
    return 'saved'
  }

  /** 遗留草稿（意外退出留下、当前没有打开的），按更新时间倒序。 */
  async listLeftoverDrafts(query: LeftoverDraftQuery): Promise<DocumentSummary[]> {
    const documents = await this.commands.listDocuments({
      kind: query.kind,
      container: query.container ?? { kind: 'any' },
      includeDrafts: true,
      includeMissing: false,
    })
    return documents.filter((document) => document.draft && !document.missing && !this.sessions.has(document.id))
  }

  /** 丢弃遗留草稿：移到回收站（误点可以找回）。 */
  async discardLeftoverDraft(document: Pick<DocumentSummary, 'id' | 'path'>): Promise<void> {
    if (this.sessions.has(document.id)) throw new Error('这份草稿正在编辑，请先关闭。')
    await this.commands.trashDocument({ id: document.id, path: document.path })
    this.logger.info('遗留草稿已移到回收站', { event: 'documents.session.leftover.discarded', context: { docId: document.id } })
  }

  /** 遗留的草稿项目（没有已打开文档的）。 */
  async listLeftoverDraftProjects(): Promise<ProjectSummary[]> {
    const projects = await this.commands.listProjects({ includeDrafts: true, includeMissing: false })
    const openProjectIds = new Set(this.list().flatMap((session) => {
      const container = session.documentMeta.container
      return container.kind === 'project' ? [container.projectId] : []
    }))
    return projects.filter((project) => project.draft && !project.missing && !openProjectIds.has(project.id))
  }

  async discardLeftoverDraftProject(projectId: string): Promise<void> {
    await this.commands.trashProject(projectId)
    this.logger.info('遗留草稿项目已移到回收站', { event: 'documents.session.leftover_project.discarded', context: { projectId } })
  }

  /** 全部会话写完（不关闭）。 */
  async flushAll(): Promise<void> {
    for (const session of this.list()) await session.flush()
  }

  /**
   * 应用退出 / 窗口关闭屏障：空草稿直接删除；其余写完最后一次（单文件包类型再写回文档文件）。
   * 有内容的草稿保留草稿标记，下次在项目页提示恢复（重要记录 007、012）。任一保存失败都会阻止关闭。
   */
  async prepareApplicationClose(): Promise<void> {
    for (const session of this.list()) {
      if (session.documentMeta.draft && session.isEmpty()) {
        try {
          if (await this.deleteEmptyDraft(session)) continue
        } catch (error) {
          this.logger.warn('退出时删除空草稿失败，保留为草稿', { event: 'documents.session.exit.delete_empty_failed', error: toError(error) })
        }
      }
      await session.commit('close')
    }
  }

  /**
   * 把已经读到的文档登记为会话（同步）：打开与新建内部用它；工具的测试夹具也用它直接造会话。
   * 已有同 ID 的会话时返回原会话。
   */
  adopt(read: DocumentReadResult, options: OpenDocumentOptions = {}): DocumentSession {
    const existing = this.sessions.get(read.meta.id)
    if (existing) return existing
    const kind = this.kinds.require(read.meta.kind)
    const session = new DocumentSession({
      read,
      kind,
      persistence: resolveDocumentPersistence(kind, this.commands, options.persistence),
      commands: this.commands,
      prompter: () => this.prompter,
      timing: this.timing,
      logger: this.logger,
      onEnded: (ended) => {
        if (this.sessions.get(ended.id) === ended) this.sessions.delete(ended.id)
        this.emit()
      },
    })
    this.sessions.set(session.id, session)
    this.logger.info('打开文档', {
      event: 'documents.session.open.completed',
      context: { docId: session.id, kind: kind.id, draft: read.meta.draft, missing: read.missingPaths.length, unresolved: read.unresolved.length },
    })
    this.emit()
    return session
  }

  /** 写完最后一次后请主进程删除；主进程认为不为空时返回 false（改走询问）。 */
  private async deleteEmptyDraft(session: DocumentSession): Promise<boolean> {
    await session.flush()
    await session.suspend()
    try {
      await this.commands.deleteEmptyDraft(session.target)
    } catch (error) {
      session.resume()
      if (isDocumentServiceError(error, 'DocumentNotEmptyError')) return false
      throw error
    }
    await session.discard()
    this.logger.info('空草稿已删除', { event: 'documents.session.leave.empty_deleted', context: { docId: session.id } })
    return true
  }

  private async trashDraft(session: DocumentSession): Promise<void> {
    await session.suspend()
    try {
      await this.commands.trashDocument(session.target)
    } catch (error) {
      session.resume()
      this.logger.warn('草稿移到回收站失败', { event: 'documents.session.leave.trash_failed', error: toError(error), context: { docId: session.id } })
      throw error
    }
    await session.discard()
    this.logger.info('草稿已移到回收站', { event: 'documents.session.leave.trashed', context: { docId: session.id } })
  }

  private async trashProject(project: ProjectSummary, sessions: DocumentSession[]): Promise<void> {
    for (const session of sessions) await session.suspend()
    try {
      await this.commands.trashProject(project.id)
    } catch (error) {
      for (const session of sessions) session.resume()
      this.logger.warn('草稿项目移到回收站失败', { event: 'documents.session.leave_project.trash_failed', error: toError(error), context: { projectId: project.id } })
      throw error
    }
    for (const session of sessions) await session.discard()
    this.logger.info('草稿项目已移到回收站', { event: 'documents.session.leave_project.trashed', context: { projectId: project.id } })
  }

  private checkDocumentSaveName(session: DocumentSession, name: string, folder: string | null): Promise<NameCheckResult> {
    return this.commands.checkName({
      subject: { type: 'document', kind: session.kind.id },
      name,
      location: folder ? { folder } : { renaming: session.documentMeta.path },
    })
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

let defaultRegistry: DocumentSessionRegistry | null = null

/** 应用里唯一的会话登记表；第一次取用时登记退出屏障（复用 applicationCloseGuards）。 */
export function getDocumentSessionRegistry(): DocumentSessionRegistry {
  if (!defaultRegistry) {
    const registry = new DocumentSessionRegistry()
    registerApplicationCloseGuard(() => registry.prepareApplicationClose())
    defaultRegistry = registry
  }
  return defaultRegistry
}
