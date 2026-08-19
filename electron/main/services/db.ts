import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { runAgentSchemaMigrations } from './agent-runtime/persistence/migrations'

export type SqlBindValue = string | number | boolean | null | Uint8Array

export interface SqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

const APP_IDENTIFIER = 'com.henji.ai'
const DATA_DIR_NAME = 'Henji-AI'
const DB_FILE_NAME = 'henji.db'

let db: Database.Database | null = null

function getBaseLocalDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
  }

  if (process.platform === 'darwin') {
    return path.join(app.getPath('appData'), APP_IDENTIFIER)
  }

  return path.join(app.getPath('appData'), APP_IDENTIFIER)
}

export function getHenjiDataDir(): string {
  return path.join(getBaseLocalDataDir(), DATA_DIR_NAME)
}

export function getHenjiDbPath(): string {
  return path.join(getHenjiDataDir(), DB_FILE_NAME)
}

function normalizeParams(params?: SqlBindValue[]): unknown[] {
  return (params ?? []).map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    return value
  })
}

function ensureWriteStatement(sql: string): void {
  const head = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase()
  if (!head || ['SELECT', 'PRAGMA'].includes(head)) {
    throw new Error('Use db:select for read statements')
  }
}

function ensureReadStatement(sql: string): void {
  const head = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase()
  if (!head || !['SELECT', 'PRAGMA', 'WITH'].includes(head)) {
    throw new Error('Use db:execute for write statements')
  }
}

export function initializeSchema(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT,
      params TEXT NOT NULL,
      file_path TEXT,
      task_id TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      cost REAL,
      duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      model_id TEXT,
      params TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      use_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      base_model TEXT,
      config TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS progress_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      profile_key TEXT NOT NULL,
      time_bucket TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_progress_samples_lookup
      ON progress_samples (model_id, profile_key, time_bucket, finished_at_ms DESC);

    CREATE TABLE IF NOT EXISTS storyboard_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      viewport_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      cover_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_storyboard_projects_updated_at
      ON storyboard_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS camera_stage_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      object_count INTEGER NOT NULL DEFAULT 0,
      scene_json TEXT NOT NULL,
      cover_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_camera_stage_projects_updated_at
      ON camera_stage_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS canvas_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      viewport_json TEXT NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_canvas_projects_updated_at
      ON canvas_projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS pending_task_results (
      server_task_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      completed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
      display_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('generated', 'canvas', 'camera-stage', 'imported', 'external')),
      mime_type TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      thumbnail_path TEXT,
      inspection_status TEXT NOT NULL DEFAULT 'pending' CHECK (inspection_status IN ('pending', 'ready', 'missing', 'failed')),
      inspection_error TEXT,
      file_modified_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_library_items (
      library_id TEXT NOT NULL REFERENCES asset_libraries(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      sort_order INTEGER,
      PRIMARY KEY (library_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_tag_items (
      tag_id TEXT NOT NULL REFERENCES asset_tags(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (tag_id, asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
    CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_last_used_at ON assets(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_library_items_asset ON asset_library_items(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tag_items_asset ON asset_tag_items(asset_id);
  `)
  ensureColumn(conn, 'storyboard_projects', 'cover_path', 'TEXT')
  ensureColumn(conn, 'camera_stage_projects', 'cover_path', 'TEXT')
  runAgentSchemaMigrations(conn)
}

/**
 * 给本文件用 `CREATE TABLE IF NOT EXISTS` 维护的老表补列。
 *
 * 这些表不走 `app_schema_migrations` 版本账本（那是主进程 agent 侧的），
 * 而 `IF NOT EXISTS` 对已存在的库不会追加新列，所以旧库必须在这里显式补。
 */
function ensureColumn(conn: Database.Database, table: string, column: string, definition: string): void {
  const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((item) => item.name === column)) {
    return
  }
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function getDb(): Database.Database {
  if (db) {
    return db
  }

  fs.mkdirSync(getHenjiDataDir(), { recursive: true })
  db = new Database(getHenjiDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initializeSchema(db)
  return db
}

export function executeSql(sql: string, params?: SqlBindValue[]): SqlExecuteResult {
  ensureWriteStatement(sql)
  const result = getDb().prepare(sql).run(...normalizeParams(params))
  return {
    rowsAffected: result.changes,
    lastInsertId: typeof result.lastInsertRowid === 'number' ? result.lastInsertRowid : Number(result.lastInsertRowid),
  }
}

export function selectSql<T = unknown>(sql: string, params?: SqlBindValue[]): T[] {
  ensureReadStatement(sql)
  return getDb().prepare(sql).all(...normalizeParams(params)) as T[]
}
