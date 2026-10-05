import type Database from 'better-sqlite3'

/*
 * 作品索引的表（迁移账本第 1 项，见 ../db-migrations.ts）。
 *
 * - document_index_projects / document_index_documents：可以随时删掉重建，
 *   启动后的后台扫描按作品目录与外部位置里的文件重新填满（文件才是唯一真相）。
 * - document_external_locations：用户在作品目录之外打开或保存的项目与文件夹。
 *   这是索引里唯一不能由扫描重建的数据（扫描只知道去作品目录里找），删除会让这些位置从列表消失，
 *   因此单独成表，重建索引时保留。
 *
 * path_key 是路径的比较键（Windows 不分大小写、统一正斜杠），用于唯一约束与按位置查找。
 */

export const DOCUMENT_INDEX_TABLES = {
  projects: 'document_index_projects',
  documents: 'document_index_documents',
  externalLocations: 'document_external_locations',
} as const

export function createDocumentIndexSchemaV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${DOCUMENT_INDEX_TABLES.projects} (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
      generated_folder TEXT NOT NULL,
      materials_folder TEXT NOT NULL,
      draft INTEGER NOT NULL DEFAULT 0,
      main_video_edit_id TEXT,
      created_at INTEGER NOT NULL,
      external INTEGER NOT NULL DEFAULT 0,
      missing INTEGER NOT NULL DEFAULT 0,
      manifest_mtime_ms REAL NOT NULL DEFAULT 0,
      manifest_size INTEGER NOT NULL DEFAULT 0,
      folder_birthtime_ms REAL NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${DOCUMENT_INDEX_TABLES.documents} (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      project_id TEXT,
      draft INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      kind_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      file_mtime_ms REAL NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_birthtime_ms REAL NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      missing INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_document_index_documents_kind
      ON ${DOCUMENT_INDEX_TABLES.documents}(kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_document_index_documents_project
      ON ${DOCUMENT_INDEX_TABLES.documents}(project_id);

    CREATE TABLE IF NOT EXISTS ${DOCUMENT_INDEX_TABLES.externalLocations} (
      path_key TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      location_kind TEXT NOT NULL CHECK (location_kind IN ('project', 'folder')),
      added_at INTEGER NOT NULL
    );
  `)
}
