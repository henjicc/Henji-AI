import type { DocumentKindId, DocumentListSummary, FolderLocale } from '../../../../src/core/documents/types'

/*
 * 作品索引的读写接口（文档仓库、项目服务与扫描器共用）。
 * 正式实现是 henji.db 里的 SQLite 表（index-store.ts）；索引只是文件的投影，随时可以由扫描重建。
 */

export interface IndexedProject {
  id: string
  /** 项目文件夹的绝对路径。 */
  path: string
  /** 项目名（文件夹名）。 */
  name: string
  locale: FolderLocale
  folders: { generated: string; materials: string }
  draft: boolean
  mainVideoEditId: string | null
  createdAt: number
  /** 位于作品目录“项目”文件夹之外（登记过的外部位置）。 */
  external: boolean
  missing: boolean
  manifestModifiedAt: number
  manifestSize: number
  /** 文件夹创建时间，用于判断拷贝出来的副本（较新的那个换 ID）。 */
  folderCreatedAt: number
  /** 最近一次打开其中文档的时间；只由 markDocumentOpened 写入，upsertProject 不改它。 */
  lastOpenedAt?: number | null
}

export interface IndexedDocument {
  id: string
  kind: DocumentKindId
  path: string
  /** 文档名（文件名去掉扩展名）。 */
  name: string
  /** 所在项目；独立文档为 null。 */
  projectId: string | null
  draft: boolean
  revision: number
  kindVersion: number
  createdAt: number
  updatedAt: number
  fileModifiedAt: number
  fileSize: number
  /** 文件创建时间，用于判断拷贝出来的副本（较新的那个换 ID）。 */
  fileCreatedAt: number
  summary: DocumentListSummary
  missing: boolean
  /** 最近一次打开的时间；只由 markDocumentOpened 写入，upsertDocument 不改它。 */
  lastOpenedAt?: number | null
}

export type ExternalLocationKind = 'project' | 'folder'

export interface ExternalLocation {
  path: string
  kind: ExternalLocationKind
  addedAt: number
}

export interface IndexedDocumentFilter {
  kind?: DocumentKindId
  /** undefined：全部；null：只要独立文档；字符串：某个项目。 */
  projectId?: string | null
  includeDrafts?: boolean
  includeMissing?: boolean
}

export interface DocumentCatalog {
  getDocument(id: string): IndexedDocument | null
  getDocumentByPath(path: string): IndexedDocument | null
  listDocuments(filter?: IndexedDocumentFilter): IndexedDocument[]
  /** 按 ID 写入；同一位置原有的其他 ID 记录会被替换（文件已换成另一份文档）。 */
  upsertDocument(row: IndexedDocument): void
  removeDocument(id: string): void
  /** 项目文件夹改名或移动后，把其中文档的位置整体换到新文件夹。 */
  rebaseDocuments(oldRoot: string, newRoot: string): void
  /** 记一次打开：文档与它所在的项目都记为 at（不在索引里时什么也不做）。 */
  markDocumentOpened(id: string, at: number): void

  getProject(id: string): IndexedProject | null
  getProjectByPath(path: string): IndexedProject | null
  listProjects(): IndexedProject[]
  upsertProject(row: IndexedProject): void
  /** 删除项目记录及其文档记录。 */
  removeProject(id: string): void

  listExternalLocations(): ExternalLocation[]
  addExternalLocation(path: string, kind: ExternalLocationKind): void
  removeExternalLocation(path: string): void

  /** 删除全部可重建的索引行（项目与文档），保留外部位置。 */
  clearRebuildableIndex(): void
}
