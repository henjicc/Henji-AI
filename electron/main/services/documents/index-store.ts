import type Database from 'better-sqlite3'

import { isDocumentKindId, type DocumentListSummary } from '../../../../src/core/documents/types'
import { parseAbsolutePath, pathKey, relativeSegments, formatAbsolutePath, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import type {
  DocumentCatalog,
  ExternalLocation,
  ExternalLocationKind,
  IndexedDocument,
  IndexedDocumentFilter,
  IndexedProject,
} from './catalog'
import { DOCUMENT_INDEX_TABLES as T } from './index-schema'

/** henji.db 里的作品索引（表由迁移账本第 1 项创建）。 */

interface ProjectRow {
  id: string
  path: string
  name: string
  locale: string
  generated_folder: string
  materials_folder: string
  draft: number
  main_video_edit_id: string | null
  created_at: number
  external: number
  missing: number
  manifest_mtime_ms: number
  manifest_size: number
  folder_birthtime_ms: number
  last_opened_at: number | null
}

interface DocumentRow {
  id: string
  kind: string
  path: string
  name: string
  project_id: string | null
  draft: number
  revision: number
  kind_version: number
  created_at: number
  updated_at: number
  file_mtime_ms: number
  file_size: number
  file_birthtime_ms: number
  summary_json: string
  missing: number
  last_opened_at: number | null
}

function parseSummary(json: string): DocumentListSummary {
  try {
    const value = JSON.parse(json) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const summary: DocumentListSummary = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') summary[key] = item
    }
    return summary
  } catch {
    return {}
  }
}

function toProject(row: ProjectRow): IndexedProject {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    locale: row.locale === 'en' ? 'en' : 'zh',
    folders: { generated: row.generated_folder, materials: row.materials_folder },
    draft: row.draft === 1,
    mainVideoEditId: row.main_video_edit_id,
    createdAt: row.created_at,
    external: row.external === 1,
    missing: row.missing === 1,
    manifestModifiedAt: row.manifest_mtime_ms,
    manifestSize: row.manifest_size,
    folderCreatedAt: row.folder_birthtime_ms,
    lastOpenedAt: row.last_opened_at ?? null,
  }
}

function toDocument(row: DocumentRow): IndexedDocument | null {
  if (!isDocumentKindId(row.kind)) return null
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    name: row.name,
    projectId: row.project_id,
    draft: row.draft === 1,
    revision: row.revision,
    kindVersion: row.kind_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileModifiedAt: row.file_mtime_ms,
    fileSize: row.file_size,
    fileCreatedAt: row.file_birthtime_ms,
    summary: parseSummary(row.summary_json),
    missing: row.missing === 1,
    lastOpenedAt: row.last_opened_at ?? null,
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export class DocumentIndexStore implements DocumentCatalog {
  constructor(
    private readonly db: Database.Database,
    private readonly style: PathStyle,
  ) {}

  private key(path: string): string {
    const key = pathKey(this.style, path)
    if (key === null) throw new Error(`索引路径不是绝对路径：${path}`)
    return key
  }

  getDocument(id: string): IndexedDocument | null {
    const row = this.db.prepare(`SELECT * FROM ${T.documents} WHERE id = ?`).get(id) as DocumentRow | undefined
    return row ? toDocument(row) : null
  }

  getDocumentByPath(path: string): IndexedDocument | null {
    const key = pathKey(this.style, path)
    if (key === null) return null
    const row = this.db.prepare(`SELECT * FROM ${T.documents} WHERE path_key = ?`).get(key) as DocumentRow | undefined
    return row ? toDocument(row) : null
  }

  listDocuments(filter: IndexedDocumentFilter = {}): IndexedDocument[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.kind) { clauses.push('kind = ?'); params.push(filter.kind) }
    if (filter.projectId === null) clauses.push('project_id IS NULL')
    else if (typeof filter.projectId === 'string') { clauses.push('project_id = ?'); params.push(filter.projectId) }
    if (filter.includeDrafts === false) clauses.push('draft = 0')
    if (filter.includeMissing === false) clauses.push('missing = 0')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM ${T.documents} ${where} ORDER BY updated_at DESC, name`).all(...params) as DocumentRow[]
    return rows.map(toDocument).filter((row): row is IndexedDocument => row !== null)
  }

  upsertDocument(row: IndexedDocument): void {
    const key = this.key(row.path)
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${T.documents} WHERE path_key = ? AND id <> ?`).run(key, row.id)
      this.db.prepare(`
        INSERT INTO ${T.documents} (
          id, kind, path, path_key, name, project_id, draft, revision, kind_version, created_at, updated_at,
          file_mtime_ms, file_size, file_birthtime_ms, summary_json, missing, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind, path = excluded.path, path_key = excluded.path_key, name = excluded.name,
          project_id = excluded.project_id, draft = excluded.draft, revision = excluded.revision,
          kind_version = excluded.kind_version, created_at = excluded.created_at, updated_at = excluded.updated_at,
          file_mtime_ms = excluded.file_mtime_ms, file_size = excluded.file_size,
          file_birthtime_ms = excluded.file_birthtime_ms, summary_json = excluded.summary_json,
          missing = excluded.missing, indexed_at = excluded.indexed_at
      `).run(
        row.id, row.kind, row.path, key, row.name, row.projectId, row.draft ? 1 : 0, row.revision, row.kindVersion,
        row.createdAt, row.updatedAt, row.fileModifiedAt, row.fileSize, row.fileCreatedAt,
        JSON.stringify(row.summary), row.missing ? 1 : 0, Date.now(),
      )
    })()
  }

  removeDocument(id: string): void {
    this.db.prepare(`DELETE FROM ${T.documents} WHERE id = ?`).run(id)
  }

  rebaseDocuments(oldRoot: string, newRoot: string): void {
    const oldParsed = parseAbsolutePath(this.style, oldRoot)
    const newParsed = parseAbsolutePath(this.style, newRoot)
    if (!oldParsed || !newParsed) throw new Error('项目文件夹位置无效')
    const prefix = `${this.key(oldRoot)}/`
    const rows = this.db.prepare(`SELECT * FROM ${T.documents} WHERE path_key LIKE ? ESCAPE '\\'`).all(`${escapeLike(prefix)}%`) as DocumentRow[]
    const update = this.db.prepare(`UPDATE ${T.documents} SET path = ?, path_key = ?, indexed_at = ? WHERE id = ?`)
    this.db.transaction(() => {
      for (const row of rows) {
        const parsed = parseAbsolutePath(this.style, row.path)
        const rest = parsed ? relativeSegments(this.style, oldParsed, parsed) : null
        if (!rest) continue
        const path = formatAbsolutePath(this.style, { root: newParsed.root, segments: [...newParsed.segments, ...rest] })
        update.run(path, this.key(path), Date.now(), row.id)
      }
    })()
  }

  markDocumentOpened(id: string, at: number): void {
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT project_id FROM ${T.documents} WHERE id = ?`).get(id) as { project_id: string | null } | undefined
      if (!row) return
      this.db.prepare(`UPDATE ${T.documents} SET last_opened_at = ? WHERE id = ?`).run(at, id)
      if (row.project_id) this.db.prepare(`UPDATE ${T.projects} SET last_opened_at = ? WHERE id = ?`).run(at, row.project_id)
    })()
  }

  getProject(id: string): IndexedProject | null {
    const row = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(id) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  getProjectByPath(path: string): IndexedProject | null {
    const key = pathKey(this.style, path)
    if (key === null) return null
    const row = this.db.prepare(`SELECT * FROM ${T.projects} WHERE path_key = ?`).get(key) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  listProjects(): IndexedProject[] {
    const rows = this.db.prepare(`SELECT * FROM ${T.projects} ORDER BY created_at DESC, name`).all() as ProjectRow[]
    return rows.map(toProject)
  }

  upsertProject(row: IndexedProject): void {
    const key = this.key(row.path)
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${T.projects} WHERE path_key = ? AND id <> ?`).run(key, row.id)
      this.db.prepare(`
        INSERT INTO ${T.projects} (
          id, path, path_key, name, locale, generated_folder, materials_folder, draft, main_video_edit_id,
          created_at, external, missing, manifest_mtime_ms, manifest_size, folder_birthtime_ms, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path, path_key = excluded.path_key, name = excluded.name, locale = excluded.locale,
          generated_folder = excluded.generated_folder, materials_folder = excluded.materials_folder,
          draft = excluded.draft, main_video_edit_id = excluded.main_video_edit_id, created_at = excluded.created_at,
          external = excluded.external, missing = excluded.missing, manifest_mtime_ms = excluded.manifest_mtime_ms,
          manifest_size = excluded.manifest_size, folder_birthtime_ms = excluded.folder_birthtime_ms,
          indexed_at = excluded.indexed_at
      `).run(
        row.id, row.path, key, row.name, row.locale, row.folders.generated, row.folders.materials,
        row.draft ? 1 : 0, row.mainVideoEditId, row.createdAt, row.external ? 1 : 0, row.missing ? 1 : 0,
        row.manifestModifiedAt, row.manifestSize, row.folderCreatedAt, Date.now(),
      )
    })()
  }

  removeProject(id: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${T.documents} WHERE project_id = ?`).run(id)
      this.db.prepare(`DELETE FROM ${T.projects} WHERE id = ?`).run(id)
    })()
  }

  listExternalLocations(): ExternalLocation[] {
    const rows = this.db.prepare(`SELECT path, location_kind, added_at FROM ${T.externalLocations} ORDER BY added_at`).all() as Array<{ path: string; location_kind: string; added_at: number }>
    return rows.map((row) => ({ path: row.path, kind: row.location_kind === 'folder' ? 'folder' : 'project', addedAt: row.added_at }))
  }

  addExternalLocation(path: string, kind: ExternalLocationKind): void {
    this.db.prepare(`
      INSERT INTO ${T.externalLocations} (path_key, path, location_kind, added_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(path_key) DO UPDATE SET path = excluded.path, location_kind = excluded.location_kind
    `).run(this.key(path), path, kind, Date.now())
  }

  removeExternalLocation(path: string): void {
    const key = pathKey(this.style, path)
    if (key !== null) this.db.prepare(`DELETE FROM ${T.externalLocations} WHERE path_key = ?`).run(key)
  }

  clearRebuildableIndex(): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${T.documents}`).run()
      this.db.prepare(`DELETE FROM ${T.projects}`).run()
    })()
  }
}
