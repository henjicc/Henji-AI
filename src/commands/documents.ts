import type { ListPage, ListPageRequest } from '@/core/documents/pagination'
import { getPlatform } from '@/platform'
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
} from '@/platform/contracts/documents'

/*
 * 文档底座命令（存储底座 2.2）：渲染层访问作品文件、项目、作品索引与通用封面的唯一入口。
 * 文档会话（2.4）、通用文档操作与助手通用能力（2.5）、各工具接入（3.x）都经这里，不直接碰 IPC。
 * 内容里的位置在这里已经是绝对路径；相对写法只出现在磁盘与数据库里。
 */

const documents = (): ReturnType<typeof getPlatform>['documents'] => getPlatform().documents

export async function listDocuments(query?: DocumentListQuery): Promise<DocumentSummary[]> {
  return await documents().listDocuments(query)
}

export async function readDocument(target: DocumentTarget): Promise<DocumentReadResult> {
  return await documents().readDocument(target)
}

export async function createDocument(request: CreateDocumentRequest): Promise<DocumentReadResult> {
  return await documents().createDocument(request)
}

export async function saveDocument(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
  return await documents().saveDocument(request)
}

export async function renameDocument(request: RenameDocumentRequest): Promise<DocumentMeta> {
  return await documents().renameDocument(request)
}

export async function finalizeDocument(request: FinalizeDocumentRequest): Promise<DocumentTransferResult> {
  return await documents().finalizeDocument(request)
}

export async function moveDocument(request: MoveDocumentRequest): Promise<DocumentTransferResult> {
  return await documents().moveDocument(request)
}

export async function duplicateDocument(request: DuplicateDocumentRequest): Promise<DocumentTransferResult> {
  return await documents().duplicateDocument(request)
}

export async function trashDocument(target: DocumentTarget): Promise<void> {
  await documents().trashDocument(target)
}

export async function deleteEmptyDraft(target: DocumentTarget): Promise<void> {
  await documents().deleteEmptyDraft(target)
}

/** 从列表移除找不到文件的文档（只改作品索引，不动磁盘）。 */
export async function forgetDocument(docId: string): Promise<void> {
  await documents().forgetDocument(docId)
}

/** 记一次打开（作品索引的最近打开时间）；只由文档会话登记表调用。 */
export async function markDocumentOpened(docId: string): Promise<void> {
  await documents().markDocumentOpened(docId)
}

export async function revealDocument(target: DocumentTarget): Promise<void> {
  await documents().revealDocument(target)
}

/** 收集素材：外部与别处的文件复制进文档所在容器的“素材”并改写引用。 */
export async function collectDocumentMedia(target: DocumentTarget): Promise<DocumentTransferResult> {
  return await documents().collectDocumentMedia(target)
}

/** 把文件复制进容器的“生成结果”或“素材”；已在容器里的原样返回。 */
export async function importFileToContainer(request: ImportFileRequest): Promise<ImportFileResult> {
  return await documents().importFile(request)
}

export async function resolveDocumentLink(link: DocumentLink): Promise<DocumentLinkResolution> {
  return await documents().resolveDocumentLink(link)
}

export async function checkDocumentName(request: NameCheckRequest): Promise<NameCheckResult> {
  return await documents().checkName(request)
}

export async function getDocumentCover(docId: string): Promise<string | null> {
  return await documents().getDocumentCover(docId)
}

export async function saveDocumentCover(request: SaveDocumentCoverRequest): Promise<DocumentCoverResult> {
  return await documents().saveDocumentCover(request)
}

export async function refreshDocumentIndex(): Promise<DocumentIndexScanReport> {
  return await documents().refreshIndex()
}

/** 文档会话状态（撤销记录、视口等，存在程序目录，随时可丢）；没有时返回 null。 */
export async function readDocumentSessionState(request: DocumentSessionStateKey): Promise<unknown> {
  return await documents().readSessionState(request)
}

export async function writeDocumentSessionState(request: WriteDocumentSessionStateRequest): Promise<void> {
  await documents().writeSessionState(request)
}

export async function listProjects(query?: ProjectListQuery): Promise<ProjectSummary[]> {
  return await documents().listProjects(query)
}

export async function createProject(request?: CreateProjectRequest): Promise<ProjectSummary> {
  return await documents().createProject(request)
}

export async function renameProject(request: RenameProjectRequest): Promise<ProjectSummary> {
  return await documents().renameProject(request)
}

export async function finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary> {
  return await documents().finalizeProject(request)
}

export async function setProjectMainDocument(request: SetProjectMainDocumentRequest): Promise<ProjectSummary> {
  return await documents().setProjectMainDocument(request)
}

export async function trashProject(projectId: string): Promise<void> {
  await documents().trashProject(projectId)
}

export async function registerExternalProject(folderPath: string): Promise<ProjectSummary> {
  return await documents().registerExternalProject(folderPath)
}

/** 打开别处的文档文件：登记所在项目或文件夹为外部位置，返回列表项（4.4）。 */
export async function registerExternalDocument(filePath: string): Promise<DocumentSummary> {
  return await documents().registerExternalDocument(filePath)
}

export async function forgetExternalLocation(folderPath: string): Promise<void> {
  await documents().forgetExternalLocation(folderPath)
}

export async function revealProject(projectId: string): Promise<void> {
  await documents().revealProject(projectId)
}

/** 导出单个文档为单文件包（4.1）；不给位置时放进作品目录“导出”。 */
export async function exportDocumentPackage(request: ExportDocumentPackageRequest): Promise<PackageExportResult> {
  return await documents().exportDocumentPackage(request)
}

/** 导出整个项目为单文件包（4.1）；不给位置时放进作品目录“导出”。 */
export async function exportProjectPackage(request: ExportProjectPackageRequest): Promise<PackageExportResult> {
  return await documents().exportProjectPackage(request)
}

/** 导入单文件包（4.1）：文档包放进给定容器，项目包放进“项目”文件夹；ID 冲突换新。 */
export async function importDocumentPackage(request: ImportPackageRequest): Promise<PackageImportResult> {
  return await documents().importPackage(request)
}

export async function listDocumentsPage(query?: DocumentListQuery & ListPageRequest): Promise<ListPage<DocumentSummary>> {
  return await documents().listDocumentsPage(query)
}

export async function listProjectsPage(query?: ProjectListQuery & ListPageRequest): Promise<ListPage<ProjectSummary>> {
  return await documents().listProjectsPage(query)
}
