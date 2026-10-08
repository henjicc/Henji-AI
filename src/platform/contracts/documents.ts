import type { CodeFileReference } from '../../core/videoEdit/codeMaterial/sources'
import type { CodeComponent, CodeComponentVersion } from '../../core/videoEdit/codeMaterial/components'
import type { WithdrawCodeComponentRequest, WriteCodeVersionRequest, PublishCodeComponentRequest } from '../../core/videoEdit/codeMaterial/storageContract'
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
  DocumentSessionStateKey,
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
  ExportDocumentPackageRequest,
  ExportProjectPackageRequest,
  ImportPackageRequest,
  PackageExportResult,
  PackageImportResult,
  FinalizeDocumentRequest,
  FinalizeProjectRequest,
  ImportFileRequest,
  ImportFileResult,
  MoveDocumentRequest,
  NameCheckRequest,
  NameCheckResult,
  ProjectListQuery,
  ProjectSummary,
  RenameDocumentRequest,
  RenameProjectRequest,
  SaveDocumentCoverRequest,
  SaveDocumentRequest,
  SetProjectMainDocumentRequest,
  WriteDocumentSessionStateRequest,
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
  /** 事务补偿：撤回可发现的发布，保留源码及固定引用，不删除文件。 */
  withdrawCodeComponent(request: WithdrawCodeComponentRequest): Promise<void>
  writeCodeVersion(request: WriteCodeVersionRequest): Promise<{ folder: string; files: CodeFileReference[] }>
  readCodeFile(file: CodeFileReference): Promise<string>
  listCodeComponents(target: DocumentTarget): Promise<CodeComponent[]>
  publishCodeComponent(request: PublishCodeComponentRequest): Promise<CodeComponentVersion>
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
  /** 从列表移除找不到文件的文档（只改作品索引，不动磁盘）；文件还在时报 DocumentLocationError。 */
  forgetDocument(docId: string): Promise<void>
  /** 记一次打开（只写作品索引的最近打开时间，所在项目一并记上）；由文档会话登记表统一调用。 */
  markDocumentOpened(docId: string): Promise<void>
  revealDocument(target: DocumentTarget): Promise<void>
  /**
   * 收集素材：把文档引用到的、不在所在容器里的文件（外部文件、作品目录或别的项目里的文件）
   * 复制进容器的“素材”文件夹并改写引用，版本加一。其他文档文件不复制。
   */
  collectDocumentMedia(target: DocumentTarget): Promise<DocumentTransferResult>
  /** 把一个文件复制进容器的“生成结果”或“素材”（同名且内容相同时复用，不同则加序号，从不覆盖）。 */
  importFile(request: ImportFileRequest): Promise<ImportFileResult>
  resolveDocumentLink(link: DocumentLink): Promise<DocumentLinkResolution>
  /** 名称检查：只在同一个文件夹里查重，返回可用 / 重名 / 非法。 */
  checkName(request: NameCheckRequest): Promise<NameCheckResult>
  getDocumentCover(docId: string): Promise<string | null>
  saveDocumentCover(request: SaveDocumentCoverRequest): Promise<DocumentCoverResult>
  /** 扫描作品目录与外部位置，更新作品索引；返回本轮统计。 */
  refreshIndex(): Promise<DocumentIndexScanReport>
  /** 读取文档会话状态（撤销记录、视口等，存在程序目录）；没有时返回 null。 */
  readSessionState(request: DocumentSessionStateKey): Promise<unknown>
  /** 写入文档会话状态；value 为 null 时清除。 */
  writeSessionState(request: WriteDocumentSessionStateRequest): Promise<void>

  listProjects(query?: ProjectListQuery): Promise<ProjectSummary[]>
  /** 新建项目：不给名字时以草稿建在“项目”文件夹里并自动起名。 */
  createProject(request?: CreateProjectRequest): Promise<ProjectSummary>
  renameProject(request: RenameProjectRequest): Promise<ProjectSummary>
  /** 项目第一次保存：起名、去掉草稿标记，可另选父文件夹（整体移过去并登记为外部位置）。 */
  finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary>
  /** 设置项目说明里的主剪辑（打开项目时打开它）；只能是该项目里的剪辑。 */
  setProjectMainDocument(request: SetProjectMainDocumentRequest): Promise<ProjectSummary>
  trashProject(projectId: string): Promise<void>
  /** 打开作品目录之外的项目文件夹并登记为外部位置。 */
  registerExternalProject(folderPath: string): Promise<ProjectSummary>
  /** 打开别处的文档文件：登记所在项目或文件夹为外部位置并返回列表项（4.4）。 */
  registerExternalDocument(filePath: string): Promise<DocumentSummary>
  /** 从列表里移除外部位置（不动磁盘上的文件）。 */
  forgetExternalLocation(folderPath: string): Promise<void>
  revealProject(projectId: string): Promise<void>

  /** 导出单个文档为单文件包（含引用的素材与内嵌图层包）；不给位置时放进作品目录“导出”。 */
  exportDocumentPackage(request: ExportDocumentPackageRequest): Promise<PackageExportResult>
  /** 导出整个项目为单文件包；不给位置时放进作品目录“导出”。 */
  exportProjectPackage(request: ExportProjectPackageRequest): Promise<PackageExportResult>
  /** 导入单文件包：文档包放进给定容器（默认作品目录），项目包放进“项目”文件夹；ID 冲突换新。 */
  importPackage(request: ImportPackageRequest): Promise<PackageImportResult>
}

/** IPC 通道名与 DocumentsPlatform 方法一一对应（主进程注册与 preload 桥共用）。 */
export const DOCUMENT_IPC_CHANNELS = {
  withdrawCodeComponent: 'documents:code:withdrawComponent',
  writeCodeVersion: 'documents:code:writeVersion',
  readCodeFile: 'documents:code:readFile',
  listCodeComponents: 'documents:code:listComponents',
  publishCodeComponent: 'documents:code:publishComponent',
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
  forgetDocument: 'documents:forget',
  markDocumentOpened: 'documents:markOpened',
  revealDocument: 'documents:reveal',
  collectDocumentMedia: 'documents:collectMedia',
  importFile: 'documents:importFile',
  resolveDocumentLink: 'documents:resolveLink',
  checkName: 'documents:checkName',
  getDocumentCover: 'documents:cover:get',
  saveDocumentCover: 'documents:cover:save',
  refreshIndex: 'documents:index:refresh',
  readSessionState: 'documents:sessionState:read',
  writeSessionState: 'documents:sessionState:write',
  listProjects: 'documents:projects:list',
  createProject: 'documents:projects:create',
  renameProject: 'documents:projects:rename',
  finalizeProject: 'documents:projects:finalize',
  setProjectMainDocument: 'documents:projects:setMain',
  trashProject: 'documents:projects:trash',
  registerExternalProject: 'documents:projects:registerExternal',
  registerExternalDocument: 'documents:registerExternal',
  forgetExternalLocation: 'documents:locations:forget',
  revealProject: 'documents:projects:reveal',
  exportDocumentPackage: 'documents:package:exportDocument',
  exportProjectPackage: 'documents:package:exportProject',
  importPackage: 'documents:package:import',
} as const satisfies Record<keyof DocumentsPlatform, string>
