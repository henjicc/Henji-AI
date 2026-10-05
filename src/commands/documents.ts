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
  DocumentSummary,
  DocumentTarget,
  DocumentTransferResult,
  DuplicateDocumentRequest,
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

export async function forgetExternalLocation(folderPath: string): Promise<void> {
  await documents().forgetExternalLocation(folderPath)
}

export async function revealProject(projectId: string): Promise<void> {
  await documents().revealProject(projectId)
}
