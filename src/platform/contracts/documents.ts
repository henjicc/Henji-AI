import type {
  CreateDocumentRequest,
  CreateProjectRequest,
  DocumentCoverResult,
  DocumentIndexScanReport,
  DocumentLink,
  DocumentLinkResolution,
  DocumentListQuery,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
  FinalizeDocumentRequest,
  FinalizeProjectRequest,
  MoveDocumentRequest,
  NameCheckRequest,
  NameCheckResult,
  ProjectListQuery,
  ProjectSummary,
  RenameDocumentRequest,
  RenameProjectRequest,
  SaveDocumentCoverRequest,
  SaveDocumentRequest,
} from '../../core/documents/types'

/*
 * 文档底座的平台接口（存储底座 2.2）：主进程文档仓库、项目服务、作品索引与通用封面。
 * 数据类型定义在 `src/core/documents/types.ts`（主进程与渲染层共用），这里只描述调用面；
 * 主进程 DocumentService 与 preload 桥按同一接口实现，类型由编译器对齐。
 *
 * 失败时抛出的错误按 name 区分：DocumentNotFoundError、DocumentRevisionConflictError、
 * DocumentNameConflictError、DocumentNameInvalidError、DocumentLocationError、DocumentNotEmptyError、
 * DocumentFormatError、DocumentUnsupportedError、ProjectNotFoundError、FileInUseError。
 */

export type * from '../../core/documents/types'

export interface DocumentsPlatform {
  /** 列出文档（查作品索引；按类型、容器、草稿与缺失筛选），按更新时间倒序。 */
  listDocuments(query?: DocumentListQuery): Promise<DocumentSummary[]>
  /** 读取文档：内容里的位置已换回绝对路径，并授权媒体协议读取所在外部容器与外部引用目录。 */
  readDocument(target: DocumentTarget): Promise<DocumentReadResult>
  createDocument(request: CreateDocumentRequest): Promise<DocumentReadResult>
  saveDocument(request: SaveDocumentRequest): Promise<DocumentSaveResult>
  renameDocument(request: RenameDocumentRequest): Promise<DocumentMeta>
  /** 草稿转正（第一次保存）：起名、去掉草稿标记，可另选位置。 */
  finalizeDocument(request: FinalizeDocumentRequest): Promise<DocumentTransferResult>
  moveDocument(request: MoveDocumentRequest): Promise<DocumentTransferResult>
  duplicateDocument(request: DuplicateDocumentRequest): Promise<DocumentTransferResult>
  /** 移到系统回收站。 */
  trashDocument(target: DocumentTarget): Promise<void>
  /** 只删除内容为空的草稿；不是空草稿时报 DocumentNotEmptyError。 */
  deleteEmptyDraft(target: DocumentTarget): Promise<void>
  revealDocument(target: DocumentTarget): Promise<void>
  resolveDocumentLink(link: DocumentLink): Promise<DocumentLinkResolution>
  /** 名称检查：只在同一个文件夹里查重，返回可用 / 重名 / 非法。 */
  checkName(request: NameCheckRequest): Promise<NameCheckResult>
  getDocumentCover(docId: string): Promise<string | null>
  saveDocumentCover(request: SaveDocumentCoverRequest): Promise<DocumentCoverResult>
  /** 扫描作品目录与外部位置，更新作品索引；返回本轮统计。 */
  refreshIndex(): Promise<DocumentIndexScanReport>

  listProjects(query?: ProjectListQuery): Promise<ProjectSummary[]>
  /** 新建项目：不给名字时以草稿建在“项目”文件夹里并自动起名。 */
  createProject(request?: CreateProjectRequest): Promise<ProjectSummary>
  renameProject(request: RenameProjectRequest): Promise<ProjectSummary>
  /** 项目第一次保存：起名、去掉草稿标记，可另选父文件夹（整体移过去并登记为外部位置）。 */
  finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary>
  trashProject(projectId: string): Promise<void>
  /** 打开作品目录之外的项目文件夹并登记为外部位置。 */
  registerExternalProject(folderPath: string): Promise<ProjectSummary>
  /** 从列表里移除外部位置（不动磁盘上的文件）。 */
  forgetExternalLocation(folderPath: string): Promise<void>
  revealProject(projectId: string): Promise<void>
}

/** IPC 通道名与 DocumentsPlatform 方法一一对应（主进程注册与 preload 桥共用）。 */
export const DOCUMENT_IPC_CHANNELS = {
  listDocuments: 'documents:list',
  readDocument: 'documents:read',
  createDocument: 'documents:create',
  saveDocument: 'documents:save',
  renameDocument: 'documents:rename',
  finalizeDocument: 'documents:finalize',
  moveDocument: 'documents:move',
  duplicateDocument: 'documents:duplicate',
  trashDocument: 'documents:trash',
  deleteEmptyDraft: 'documents:deleteEmptyDraft',
  revealDocument: 'documents:reveal',
  resolveDocumentLink: 'documents:resolveLink',
  checkName: 'documents:checkName',
  getDocumentCover: 'documents:cover:get',
  saveDocumentCover: 'documents:cover:save',
  refreshIndex: 'documents:index:refresh',
  listProjects: 'documents:projects:list',
  createProject: 'documents:projects:create',
  renameProject: 'documents:projects:rename',
  finalizeProject: 'documents:projects:finalize',
  trashProject: 'documents:projects:trash',
  registerExternalProject: 'documents:projects:registerExternal',
  forgetExternalLocation: 'documents:locations:forget',
  revealProject: 'documents:projects:reveal',
} as const satisfies Record<keyof DocumentsPlatform, string>
