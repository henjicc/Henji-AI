import type {
  CreateDocumentRequest,
  CreateProjectRequest,
  DocumentListQuery,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DocumentUnresolvedLocation,
  FinalizeDocumentRequest,
  FinalizeProjectRequest,
  NameCheckRequest,
  NameCheckResult,
  NameCheckSubject,
  ProjectListQuery,
  ProjectSummary,
  SaveDocumentRequest,
} from '@/core/documents/types'

/*
 * 文档会话（存储底座 2.4）的公共类型。
 *
 * 会话持有一份已打开文档的元信息与保存状态；工具实例持有内容与撤销，
 * 通过 DocumentContentAdapter 把内容交给会话，工具本身不知道文档存在哪、怎么存。
 */

/** 会话用到的文档命令；正式运行用 `@/commands/documents`，测试换成替身。 */
export interface DocumentSessionCommands {
  readDocument(target: DocumentTarget): Promise<DocumentReadResult>
  createDocument(request: CreateDocumentRequest): Promise<DocumentReadResult>
  saveDocument(request: SaveDocumentRequest): Promise<DocumentSaveResult>
  finalizeDocument(request: FinalizeDocumentRequest): Promise<DocumentTransferResult>
  trashDocument(target: DocumentTarget): Promise<void>
  deleteEmptyDraft(target: DocumentTarget): Promise<void>
  listDocuments(query?: DocumentListQuery): Promise<DocumentSummary[]>
  checkName(request: NameCheckRequest): Promise<NameCheckResult>
  createProject(request?: CreateProjectRequest): Promise<ProjectSummary>
  finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary>
  trashProject(projectId: string): Promise<void>
  listProjects(query?: ProjectListQuery): Promise<ProjectSummary[]>
}

/**
 * 工具接入会话的适配接口：工具实例仍是内容、撤销与界面状态的唯一持有者。
 * - getContent：保存时取当前内容（内存形态，路径为绝对路径）。不要返回之后还会被原地修改的对象。
 * - receiveContent：会话换内容时调用（冲突后“重新载入”、转正时素材被复制并改写了引用）。
 *   调用期间触发的变更通知会被会话忽略，不会再标脏。
 * - subscribe：内容一变就通知会话（会话据此标脏并防抖保存）；返回取消订阅函数。
 * - isEmpty：可选；省略时用文档类型登记里的 isEmptyContent 判断（草稿离开时用）。
 */
export interface DocumentContentAdapter<TContent = unknown> {
  getContent(): TContent
  receiveContent(content: TContent): void
  subscribe(onChange: () => void): () => void
  isEmpty?(content: TContent): boolean
}

/** 写回原因：空闲、关闭（含应用退出）、用户点“保存”。 */
export type DocumentCommitReason = 'idle' | 'close' | 'save'

/**
 * 读取目的（单文件包类型用）：open 打开、reload 冲突后按文件重新载入（放弃工作副本里的修改）、
 * relocate 改名 / 移动 / 转正后只重新定位，不动内容。
 */
export type DocumentReadPurpose = 'open' | 'reload' | 'relocate'

/**
 * 保存策略。JSON 类型每次保存直接写文档文件（`createJsonDocumentPersistence`）。
 * 单文件包类型（图片文档，3.5）：save 写程序目录里的工作副本，commit 在保存、空闲与关闭时写回 `.henjiimg`；
 * 通用仓库不读写包的内容，打开、新建与重新读取也由策略完成（read / create）。
 */
export interface DocumentPersistence {
  readonly mode: 'json' | 'package'
  /** 省略时用文档命令 readDocument（JSON 类型）。 */
  read?(target: DocumentTarget, purpose: DocumentReadPurpose): Promise<DocumentReadResult>
  /** 省略时用文档命令 createDocument（JSON 类型）。 */
  create?(request: CreateDocumentRequest): Promise<DocumentReadResult>
  save(request: SaveDocumentRequest): Promise<DocumentSaveResult>
  /** 写回文档文件；返回新的元信息（没有变化时可不返回）。 */
  commit?(reason: DocumentCommitReason, meta: DocumentMeta): Promise<DocumentMeta | void>
  /** 会话结束（关闭或丢弃）后释放工作副本等资源。 */
  dispose?(): Promise<void>
}

/**
 * - saved：磁盘与内存一致。
 * - pending：有修改，等防抖到期保存。
 * - saving：正在写。
 * - failed：写入失败，修改保留在内存，按退避自动重试，也可手动 retry。
 * - conflict：文件被别处改过，等用户选择“重新载入 / 覆盖”，期间不自动保存。
 * - closed：会话已结束。
 */
export type DocumentSessionStatus = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict' | 'closed'

export interface DocumentSessionState {
  meta: DocumentMeta
  status: DocumentSessionStatus
  /** 内存里有尚未写入磁盘的修改。 */
  dirty: boolean
  /** 最近一次失败（保存失败或冲突）；成功后清空。 */
  error: Error | null
  /** 引用到但磁盘上找不到的素材（绝对路径），打开与重新载入时更新。 */
  missingPaths: readonly string[]
  unresolved: readonly DocumentUnresolvedLocation[]
}

/** 冲突时的选择：“稍后”保持冲突状态，不写入。 */
export type DocumentConflictChoice = 'reload' | 'overwrite' | 'later'

/** 草稿离开时的选择：保存 / 不保存 / 取消。 */
export type DocumentLeaveChoice = 'save' | 'discard' | 'cancel'

/**
 * 离开结果：
 * - closed：已保存过的文档，等最后一次保存完成后关闭。
 * - saved：草稿起名并转正后关闭。
 * - discarded：空草稿已删除，或用户选择“不保存”后移到了回收站。
 * - cancelled：用户取消，留在原处，会话仍打开。
 */
export type DocumentLeaveOutcome = 'closed' | 'saved' | 'discarded' | 'cancelled'

export interface DocumentLeavePromptInfo {
  subject: 'document' | 'project'
  name: string
}

export interface DocumentSaveNamePromptInfo {
  subject: NameCheckSubject
  /** 预填的名称（草稿的自动名）。 */
  initialName: string
  /** 默认保存位置（草稿所在文件夹，绝对路径）。 */
  defaultFolder: string
  /** 实时检查名称；folder 为 null 表示默认位置。 */
  check(name: string, folder: string | null): Promise<NameCheckResult>
  /** 真正保存（起名并转正）；失败时抛错，对话框显示原因并保持打开。 */
  submit(name: string, folder: string | null): Promise<void>
}

export interface DocumentConflictPromptInfo {
  name: string
}

/** 会话需要用户决定时的提示接口；正式运行由 DocumentSessionDialogs 渲染，测试换成替身。 */
export interface DocumentSessionPrompter {
  chooseLeaveAction(info: DocumentLeavePromptInfo): Promise<DocumentLeaveChoice>
  /** 起名对话框；保存成功返回 true，取消返回 false。 */
  askSaveName(info: DocumentSaveNamePromptInfo): Promise<boolean>
  resolveConflict(info: DocumentConflictPromptInfo): Promise<DocumentConflictChoice>
}
