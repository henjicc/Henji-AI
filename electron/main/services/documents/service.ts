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
} from '../../../../src/core/documents/types'
import type { DocumentsPlatform } from '../../../../src/platform/contracts/documents'
import { isPathInside } from '../../../../src/core/storage/pathSyntax'
import type { DocumentCoverStore } from './covers'
import type { DocumentIndexScanner } from './index-scanner'
import type { ProjectService } from './projects'
import type { DocumentRepository } from './repository'
import type { DocumentWorkspace } from './workspace'

/**
 * 文档底座对外的唯一入口（IPC、后续的文档会话与助手通用能力都委托这里）。
 * 只做组合：列表查索引，读写交给文档仓库，项目交给项目服务，封面交给封面存储。
 */
export class DocumentService implements DocumentsPlatform {
  constructor(private readonly parts: {
    workspace: DocumentWorkspace
    repository: DocumentRepository
    projects: ProjectService
    scanner: DocumentIndexScanner
    covers: DocumentCoverStore
  }) {}

  async listDocuments(query: DocumentListQuery = {}): Promise<DocumentSummary[]> {
    const { workspace, covers } = this.parts
    const catalog = workspace.catalog
    const container = query.container ?? { kind: 'any' }
    const rows = catalog.listDocuments({
      kind: query.kind,
      projectId: container.kind === 'any' ? undefined : container.kind === 'user' ? null : container.projectId,
      includeDrafts: query.includeDrafts ?? true,
      includeMissing: query.includeMissing ?? true,
    })
    const projects = new Map(catalog.listProjects().map((project) => [project.id, project]))
    const coverPaths = await covers.getMany(rows.map((row) => row.id))
    const userRoot = workspace.layout().root
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      path: row.path,
      container: row.projectId ? { kind: 'project', projectId: row.projectId } : { kind: 'user' },
      draft: row.draft,
      revision: row.revision,
      kindVersion: row.kindVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      projectName: row.projectId ? projects.get(row.projectId)?.name ?? null : null,
      external: !isPathInside(workspace.style, userRoot, row.path),
      missing: row.missing,
      fileModifiedAt: row.fileModifiedAt,
      sizeBytes: row.fileSize,
      coverPath: coverPaths.get(row.id) ?? null,
      summary: row.summary,
    }))
  }

  readDocument(target: DocumentTarget): Promise<DocumentReadResult> {
    return this.parts.repository.read(target)
  }

  createDocument(request: CreateDocumentRequest): Promise<DocumentReadResult> {
    return this.parts.repository.create(request)
  }

  saveDocument(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
    return this.parts.repository.save(request)
  }

  renameDocument(request: RenameDocumentRequest): Promise<DocumentMeta> {
    return this.parts.repository.rename(request)
  }

  finalizeDocument(request: FinalizeDocumentRequest): Promise<DocumentTransferResult> {
    return this.parts.repository.finalize(request)
  }

  moveDocument(request: MoveDocumentRequest): Promise<DocumentTransferResult> {
    return this.parts.repository.move(request)
  }

  duplicateDocument(request: DuplicateDocumentRequest): Promise<DocumentTransferResult> {
    return this.parts.repository.duplicate(request)
  }

  trashDocument(target: DocumentTarget): Promise<void> {
    return this.parts.repository.trash(target)
  }

  deleteEmptyDraft(target: DocumentTarget): Promise<void> {
    return this.parts.repository.deleteEmptyDraft(target)
  }

  forgetDocument(docId: string): Promise<void> {
    return this.parts.repository.forget(docId)
  }

  revealDocument(target: DocumentTarget): Promise<void> {
    return this.parts.repository.reveal(target)
  }

  resolveDocumentLink(link: DocumentLink): Promise<DocumentLinkResolution> {
    return this.parts.repository.resolveLink(link)
  }

  checkName(request: NameCheckRequest): Promise<NameCheckResult> {
    return this.parts.repository.checkName(request)
  }

  getDocumentCover(docId: string): Promise<string | null> {
    return this.parts.covers.get(docId)
  }

  saveDocumentCover(request: SaveDocumentCoverRequest): Promise<DocumentCoverResult> {
    return this.parts.covers.save(request)
  }

  refreshIndex(): Promise<DocumentIndexScanReport> {
    return this.parts.scanner.refresh()
  }

  async listProjects(query: ProjectListQuery = {}): Promise<ProjectSummary[]> {
    return this.parts.projects.list(query)
  }

  createProject(request: CreateProjectRequest = {}): Promise<ProjectSummary> {
    return this.parts.projects.create(request)
  }

  renameProject(request: RenameProjectRequest): Promise<ProjectSummary> {
    return this.parts.projects.rename(request)
  }

  finalizeProject(request: FinalizeProjectRequest): Promise<ProjectSummary> {
    return this.parts.projects.finalize(request)
  }

  trashProject(projectId: string): Promise<void> {
    return this.parts.projects.trash(projectId)
  }

  registerExternalProject(folderPath: string): Promise<ProjectSummary> {
    return this.parts.projects.registerExternal(folderPath)
  }

  forgetExternalLocation(folderPath: string): Promise<void> {
    return this.parts.projects.forgetExternal(folderPath)
  }

  revealProject(projectId: string): Promise<void> {
    return this.parts.projects.reveal(projectId)
  }
}
